// The analyst's one stage (S-23-T3): it reads what happened on the closed PR — findings with their
// decisions and opinions, answered questions, and what people wrote on GitHub without the PR
// author's own comments (core `buildCases`) — plus the repository's lessons and open candidates,
// and asks the analyst for at most 5 lesson candidates. The run hook (`run/learning-hooks.ts`)
// merges them into the candidates when the run completes.
import { analystRequest, type AnalystCandidate, type AnalystInput } from '@pra/agents';
import { buildCases, missingInstructions, REQUIRED_INSTRUCTION_FILES, runModel } from '@pra/core';
import {
  answersOfPullRequest,
  currentDecisions,
  findingsOf,
  openCandidatesOf,
  opinionsOf,
  roundsOf,
  type FindingRow,
} from '@pra/db';
import { stageInstructions } from './instructions.ts';
import type { StageContext, StageExecutor, StageResult } from './stage.ts';

export const [ANALYST_PROMPT_FILE, ANALYST_RULES_FILE] = REQUIRED_INSTRUCTION_FILES.analyse;
export const LESSONS_FILE = 'lessons.md';

/** The Analyse stage's stored output; the run hook reads `candidates`. */
export type AnalyseOutput = {
  candidates: AnalystCandidate[];
  summary: string;
  /** What the analyst read: counts only, the input itself is the session's prompt. */
  read: { findings: number; answers: number; comments: number; authorCommentsLeftOut: number };
};

export const analyseStage: StageExecutor = {
  key: 'analyse',
  usesAgent: true,
  run: runAnalyse,
};

async function runAnalyse(context: StageContext): Promise<StageResult> {
  const { deps, run, pullRequest, repository, signal } = context;
  const instructions = await stageInstructions({ deps, run, repository });
  const prompt = instructions.get(ANALYST_PROMPT_FILE)?.trim();
  const rules = instructions.get(ANALYST_RULES_FILE)?.trim();
  if (!prompt || !rules) {
    const missing = missingInstructions(instructions, ['analyse'])[0]?.missing ?? [];
    return {
      status: 'failed',
      error: { code: 'analyst_instructions_missing', params: { missing } },
      sessions: [],
    };
  }

  const comments = await deps.github.listReviewComments(
    repository.githubFullName,
    pullRequest.number,
  );
  const cases = buildCases(comments, pullRequest.authorLogin);
  const findings = await findingsOfPullRequest(deps.db, pullRequest.id);
  const answers = await answersOfPullRequest(deps.db, pullRequest.id);
  // S-21: the model frozen on the run when it was created (Settings → Models, level override).
  const model = runModel(run, 'analyst');
  const input: AnalystInput = {
    model,
    instructions: { prompt, rules },
    pr: {
      repo: repository.slug,
      number: pullRequest.number,
      title: pullRequest.title,
      state: pullRequest.state === 'merged' ? 'merged' : 'closed',
    },
    findings,
    answers: answers.map((a) => ({ question: a.question, answer: a.answer, by: a.signerName })),
    comments: cases.map(({ id, author, body, path, line }) => ({ id, author, body, path, line })),
    lessons: instructions.get(LESSONS_FILE) ?? '',
    openCandidates: await openCandidatesOf(deps.db, repository.id),
    signal,
  };

  const result = await deps.analyst.analyse(input);
  const sent = analystRequest(input).messages[0]?.content;
  const sessions = [
    {
      role: 'analyst' as const,
      model,
      prompt: typeof sent === 'string' ? sent : JSON.stringify(sent),
      result,
    },
  ];
  if (result.status !== 'completed' || !result.output) {
    const error = result.error ?? { code: 'agent_failed', params: {} };
    return {
      status: 'failed',
      error: {
        code: error.code === 'output_invalid' ? 'analyst_output_invalid' : error.code,
        params: error.params,
      },
      sessions,
    };
  }
  const output: AnalyseOutput = {
    candidates: result.output.candidates,
    summary: result.output.summary,
    read: {
      findings: findings.length,
      answers: answers.length,
      comments: cases.length,
      authorCommentsLeftOut: comments.length - cases.length,
    },
  };
  return { status: 'succeeded', output, sessions, findings: [], questions: [], notChecked: [] };
}

/** Every round's findings of the PR with the current decision and the team's opinions. */
async function findingsOfPullRequest(
  db: StageContext['deps']['db'],
  pullRequestId: number,
): Promise<AnalystInput['findings']> {
  const rows: FindingRow[] = [];
  for (const round of await roundsOf(db, pullRequestId))
    rows.push(...(await findingsOf(db, round.id)));
  const ids = rows.map((f) => f.id);
  const [decisions, opinions] = await Promise.all([currentDecisions(db, ids), opinionsOf(db, ids)]);
  return rows.map((f) => {
    const decision = decisions.get(f.id);
    return {
      severity: f.severity,
      title: f.title,
      file: f.file,
      line: f.line,
      verdict: f.verdict,
      decision: decision?.decision ?? null,
      reason: decision?.reason ?? null,
      opinions: (opinions.get(f.id) ?? []).map((o) => ({
        by: o.signerName,
        value: o.value,
        comment: o.comment,
      })),
    };
  });
}
