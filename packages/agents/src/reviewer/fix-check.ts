// The reviewer's fix-check mode (S-07-T3, FR-019): rounds 2 and 3 of a chain read only the diff
// since the previous round and the findings decided Implement, and answer Resolved or Not
// resolved per finding. They write no new findings.
import { z } from 'zod/v4';
import { renderPrompt, withSessionDir } from '../prompt.ts';
import type { AgentProgress, AgentRunner, AgentRunResult } from '../runner.ts';
import { teamAnswersBody, type TeamAnswer } from './answers.ts';

/** A finding decided Implement, as the fix check sees it. */
export type FixCheckFinding = {
  id: number;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
  suggestion: string;
};

/** One finding's answer. */
export type FixStatus = { findingId: number; resolved: boolean; reason: string };

export type CheckFixesInput = {
  /** From the frozen level (core `modelFor`, role reviewer). */
  model: string;
  /** The run's worktree at the fix head; the session only reads it. */
  worktree: string;
  findings: readonly FixCheckFinding[];
  /** The diff from the previous round's reviewed SHA to the fix head. */
  diff: string;
  fromSha: string;
  toSha: string;
  maxTurns: number;
  maxCostUsd: number;
  stageTimeoutMinutes: number;
  /** The team's answers to earlier questions (FR-035); none adds no file and no prompt line. */
  answers?: readonly TeamAnswer[];
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgress) => void;
};

/** Added to the prompt when the PR has answers. */
export const FIX_CHECK_ANSWERS_LINE =
  "answers.md holds the team's answers to the reviewer's earlier questions; take them as given.";

/** The answer the session must follow. */
export const FixCheckAnswerSchema = z.object({
  fixes: z.array(
    z.object({
      findingId: z.number().int().describe('The `id` of the finding in findings.json.'),
      resolved: z.boolean(),
      reason: z.string().min(1).describe('One or two sentences: what the fix does or misses.'),
    }),
  ),
});

/** The reason stored for a finding the session did not answer. */
export const FIX_CHECK_NO_ANSWER = 'The fix check gave no answer for this finding.';

/** Built in: the fix check is not a stored instruction file. */
export const FIX_CHECK_PROMPT = [
  'You check whether fixes resolved findings of an earlier review of this pull request.',
  'findings.json lists the findings the team decided to implement. diff.patch holds every change',
  'from the reviewed commit {{fromSha}} to the new head {{toSha}}. The repository at the new head',
  'is in {{repoDir}}; read it when the diff alone does not tell.',
  'For every finding answer `resolved` true or false, with one or two sentences why.',
  'Check only these findings: do not review anything else and report no new findings.',
].join(' ');

/** One fix-check session. Answers for unknown ids are dropped; unanswered findings are Not resolved. */
export async function checkFixes(
  runner: AgentRunner,
  input: CheckFixesInput,
): Promise<AgentRunResult<FixStatus[]> & { prompt: string }> {
  const answers = input.answers ?? [];
  const files: Record<string, string> = {
    'findings.json': `${JSON.stringify(input.findings.map(findingJson), null, 2)}\n`,
    'diff.patch': input.diff,
    ...(answers.length ? { 'answers.md': `${teamAnswersBody(answers)}\n` } : {}),
  };
  return withSessionDir(files, async (dir) => {
    const prompt = [
      renderPrompt(FIX_CHECK_PROMPT, {
        fromSha: input.fromSha,
        toSha: input.toSha,
        repoDir: input.worktree,
      }),
      ...(answers.length ? [FIX_CHECK_ANSWERS_LINE] : []),
    ].join(' ');
    const result = await runner.run({
      role: 'reviewer',
      model: input.model,
      cwd: dir,
      readDirs: [input.worktree],
      prompt,
      outputSchema: FixCheckAnswerSchema,
      maxTurns: input.maxTurns,
      maxCostUsd: input.maxCostUsd,
      timeoutMs: input.stageTimeoutMinutes * 60_000,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    return {
      ...result,
      prompt,
      output: result.output ? fixStatuses(input.findings, result.output.fixes) : null,
    };
  });
}

/**
 * One status per finding, in the findings' order: the first answer for each id, a missing answer
 * as Not resolved. A full review (US-05) uses it with `answeredOnly` for its optional `fixes`.
 */
export function fixStatuses(
  findings: readonly Pick<FixCheckFinding, 'id'>[],
  answers: readonly FixStatus[],
  { answeredOnly = false }: { answeredOnly?: boolean } = {},
): FixStatus[] {
  const byId = new Map<number, FixStatus>();
  for (const answer of answers) if (!byId.has(answer.findingId)) byId.set(answer.findingId, answer);
  return findings.flatMap(({ id }) => {
    const answer = byId.get(id);
    if (answer) return [{ findingId: id, resolved: answer.resolved, reason: answer.reason }];
    return answeredOnly ? [] : [{ findingId: id, resolved: false, reason: FIX_CHECK_NO_ANSWER }];
  });
}

/** The claim and the agreed fix, by id. */
function findingJson({ id, title, file, line, scenario, suggestion }: FixCheckFinding) {
  return { id, title, file, line, scenario, suggestion };
}
