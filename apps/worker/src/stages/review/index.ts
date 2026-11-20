// The review stage (S-01-T9): the reviewer reads the PR in its own worktree and answers with
// findings, questions and what it did not check; core `enforce` applies the level's limits.
import {
  enforce,
  limitsFor,
  matchSensitiveFiles,
  runModel,
  severityRank,
  type ChangeType,
  type FrozenLevel,
} from '@pra/core';
import { fixStatuses } from '@pra/agents';
import { fixTargetsOfRun, readRepositoryConfig } from '@pra/db';
import { stageInstructions } from '../instructions.ts';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { changeTypeOfRun, changeTypeWhy } from '../change-type.ts';
import { sessionDirFor } from '../paths.ts';
import type {
  SessionRecord,
  StageContext,
  StageExecutor,
  StageFinding,
  StageQuestion,
  StageResult,
} from '../stage.ts';
import { runWorktree } from '../worktree.ts';
import { buildBrief, documentsFor, touchedWorkspaces } from './brief.ts';
import { stageFilesOf } from '../stage-files.ts';
import {
  materialiseInstructions,
  removeTree,
  renderReviewerPrompt,
  reviewerKnowledge,
} from './prompt.ts';
import { reviewOutputSchema, SEVERITY_MAP, type ReviewOutput } from './schema.ts';

/** Per review session; P had none, the runner requires both. */
export const REVIEW_MAX_TURNS = 100;
export const REVIEW_MAX_COST_USD = 10;

export const reviewStage: StageExecutor = {
  key: 'review',
  usesAgent: true,
  run: runReview,
};

async function runReview(context: StageContext): Promise<StageResult> {
  const { deps, run, pullRequest, repository, level, attempt, signal } = context;
  const fullName = repository.githubFullName;

  const worktree = await runWorktree(context);
  const diff = await deps.gitMirror.diff(fullName, pullRequest.baseSha, run.headSha);
  signal.throwIfAborted();
  const changed = diff.files.map((file) => file.path);

  const config = readRepositoryConfig(repository).value;
  // From level 2 the Change type stage ran first; its type narrows the limits.
  const changeType = await changeTypeOfRun(deps.db, run.id);
  const limits = limitsFor(level.settings, changeType?.changeType ?? null);
  const sections = [];
  for (const provider of deps.extensions.reviewerContext) {
    sections.push(...(await provider.sections(context)));
  }
  const brief = buildBrief({
    pullRequest,
    files: diff.files,
    sensitive: matchSensitiveFiles(changed, config.sensitivePatterns),
    documents: documentsFor(changed, await workspaceFiles(worktree, touchedWorkspaces(changed))),
    level,
    limits,
    changeType: changeType
      ? { type: changeType.changeType, reason: changeTypeWhy(changeType) }
      : null,
    sections,
  });

  const sessionDir = sessionDirFor(deps.dataDir, run.id, 'review', attempt);
  const knowledgeDir = path.join(sessionDir, 'knowledge');
  await removeTree(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, 'brief.md'), brief);
  await writeFile(path.join(sessionDir, 'diff.patch'), diff.patch);
  const instructions = await stageInstructions(context);
  // The files assigned to Review when the run started (STAGEFILES); a null prompt is the
  // built-in one.
  const assigned = stageFilesOf(run, 'review', instructions);
  await materialiseInstructions(knowledgeDir, reviewerKnowledge(assigned, instructions));

  const template = assigned.prompt ? instructions.get(assigned.prompt) : undefined;
  const prompt = renderReviewerPrompt(template, {
    knowledgeDir,
    repoDir: worktree,
    runDir: sessionDir,
  });
  const model = runModel(run, 'reviewer');
  signal.throwIfAborted();
  const result = await deps.agentRunner.run({
    role: 'reviewer',
    model,
    cwd: sessionDir,
    prompt,
    readDirs: [worktree, knowledgeDir],
    outputSchema: reviewOutputSchema,
    maxTurns: REVIEW_MAX_TURNS,
    maxCostUsd: REVIEW_MAX_COST_USD,
    // Same limit as the stage timer in execute-stage.ts, which stays the one that ends the stage.
    timeoutMs: level.settings.stageTimeoutMinutes * 60_000,
    signal,
  });
  const sessions: SessionRecord[] = [{ role: 'reviewer', model, prompt, result }];

  if (result.status !== 'completed' || !result.output) {
    const error = result.error ?? { code: 'agent_failed', params: {} };
    return {
      status: 'failed',
      error: {
        code: error.code === 'output_invalid' ? 'review_output_invalid' : error.code,
        params: error.params,
      },
      sessions,
    };
  }
  // US-05: a full review also says whether the earlier Implement findings are resolved now.
  const answers = result.output.fixes ?? [];
  const earlier = answers.length ? (await fixTargetsOfRun(deps.db, run)).findings : [];
  return {
    status: 'succeeded',
    sessions,
    ...mapReview(result.output, level, changeType?.changeType ?? null),
    fixChecks: fixStatuses(earlier, answers, { answeredOnly: true }),
  };
}

/** P's answer to stored findings and questions, cut to the level's limits. */
export function mapReview(
  output: ReviewOutput,
  level: Pick<FrozenLevel, 'settings'>,
  changeType: ChangeType | null = null,
): {
  output: unknown;
  findings: StageFinding[];
  questions: StageQuestion[];
  notChecked: string[];
} {
  const mapped = output.findings.map((finding) => ({
    finding: {
      severity: SEVERITY_MAP[finding.severity],
      title: finding.title,
      file: finding.file,
      line: finding.line > 0 ? finding.line : null,
      scenario: finding.scenario,
      suggestion: finding.suggestion,
    } satisfies StageFinding,
    fix: finding.fix ?? null,
  }));
  const questions = output.questions.map((question): StageQuestion => ({
    text: question.question,
    options: question.options,
    recommended: question.recommended < question.options.length ? question.recommended : null,
    why: question.why,
  }));
  const enforced = enforce(
    { findings: mapped.map((m) => ({ ...m.finding, fix: m.fix })), questions },
    limitsFor(level.settings, changeType),
  );
  // `enforce` keeps the reviewer's order; findings are stored most severe first.
  const kept = enforced.findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        severityRank(a.finding.severity) - severityRank(b.finding.severity) || a.index - b.index,
    )
    .map(({ finding }) => finding);

  return {
    output: {
      summary: output.summary,
      risk: output.risk,
      gatedNotes: output.gatedNotes ?? [],
      // Fixes have no column yet; kept by finding position (1-based ordinal).
      fixes: kept.flatMap((f, i) => (f.fix ? [{ ordinal: i + 1, ...f.fix }] : [])),
      changeType,
      reported: { findings: output.findings.length, questions: output.questions.length },
      dropped: enforced.dropped,
      reasons: enforced.reasons,
    },
    findings: kept.map(({ severity, title, file, line, scenario, suggestion }) => ({
      severity,
      title,
      file,
      line,
      scenario,
      suggestion,
    })),
    questions: enforced.questions,
    notChecked: output.notChecked,
  };
}

/** Files under the given workspace directories of the worktree, as repository paths. */
async function workspaceFiles(worktree: string, workspaces: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const workspace of workspaces) {
    const dir = path.join(worktree, workspace);
    const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relative = path.relative(worktree, path.join(entry.parentPath, entry.name));
      if (relative.split(path.sep).includes('node_modules')) continue;
      files.push(relative.split(path.sep).join('/'));
    }
  }
  return files.sort();
}
