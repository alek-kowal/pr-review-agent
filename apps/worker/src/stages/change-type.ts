// The Change type stage (S-04-T5), from level 2 after Task: the repository's path and size rules
// set the floor, the judge may raise it (never lower), and a type a person forced wins and skips
// the judge. Review reads the result to cut its findings to the type's limits; a PR above the
// repository's line threshold is flagged as large.
import { judgeRequest, judgeWithFallback, type JudgeFallback } from '@pra/agents';
import {
  classifyChange,
  runModel,
  needsPerson,
  raiseChangeType,
  type ChangeType,
  type Reason,
} from '@pra/core';
import { readRepositoryConfig, succeededStageOutput, type Db } from '@pra/db';
import { stageInstructions } from './instructions.ts';
import { stageFilesOf } from './stage-files.ts';
import type { SessionRecord, StageContext, StageExecutor, StageResult } from './stage.ts';
import { taskOfRun, taskText } from './task.ts';
import { runWorktree } from './worktree.ts';

export const JUDGE_PROMPT_FILE = 'prompt-classifier.md';
export const JUDGE_RULES_FILE = 'classify-rules.md';

/** The Change type stage's stored output. */
export type ChangeTypeOutput = {
  changeType: ChangeType;
  /** Why: the rules' floor, the judge's raise or agreement, or a person's choice (core codes). */
  reason: Reason;
  /** What the path and size rules picked, and why. */
  rules: { changeType: ChangeType; reason: Reason };
  /** The judge's own answer; null when it did not run. */
  judge: { changeType: ChangeType; reason: string } | null;
  /** Why the judge did not run: `forced`, `floor_is_highest` or `judge_instructions_missing`. */
  judgeSkipped: { code: string; params: Record<string, unknown> } | null;
  /**
   * The OpenRouter judge failed and the Claude judge answered instead (P-26): the models and
   * why (`openrouter_no_credits`, `openrouter_timeout`, `output_invalid`, ...). Absent or null
   * when there was no fallback.
   */
  judgeFallback?: JudgeFallback | null;
  forced: ChangeType | null;
  /** A One-way door, or files the rules flagged as one, need a person. */
  needsPerson: boolean;
  lines: number;
  largePr: boolean;
  largePrLines: number;
};

export const changeTypeStage: StageExecutor = {
  key: 'change_type',
  usesAgent: true,
  run: runChangeType,
};

async function runChangeType(context: StageContext): Promise<StageResult> {
  const { deps, run, pullRequest, repository, signal } = context;
  const config = readRepositoryConfig(repository).value;

  await runWorktree(context);
  const diff = await deps.gitMirror.diff(
    repository.githubFullName,
    pullRequest.baseSha,
    run.headSha,
  );
  const files = diff.files.map((file) => file.path);
  const floor = classifyChange({
    files,
    diff: diff.patch,
    rules: config.changeTypeRules,
    sensitivePatterns: config.sensitivePatterns,
  });
  const forced = pullRequest.forcedChangeType ?? null;

  const sessions: SessionRecord[] = [];
  let judged: ChangeTypeOutput['judge'] = null;
  let judgeSkipped: ChangeTypeOutput['judgeSkipped'] = null;
  let judgeFallback: JudgeFallback | null = null;
  if (forced) {
    judgeSkipped = { code: 'forced', params: { forced } };
  } else if (floor.changeType === 'one_way_door') {
    judgeSkipped = { code: 'floor_is_highest', params: {} };
  } else {
    const instructions = await stageInstructions({ deps, run, repository });
    // The files assigned to the judge when the run started (STAGEFILES).
    const assigned = stageFilesOf(run, 'change_type', instructions);
    const keys = [assigned.prompt ?? JUDGE_PROMPT_FILE, assigned.rules ?? JUDGE_RULES_FILE];
    const [prompt, rules] = keys.map((key) => instructions.get(key)?.trim());
    if (!prompt || !rules) {
      const missing = keys.filter((key) => !instructions.get(key));
      judgeSkipped = { code: 'judge_instructions_missing', params: { missing } };
    } else {
      const model = runModel(run, 'judge');
      const input = {
        model,
        instructions: { prompt, rules },
        task: taskText(await taskOfRun(deps.db, run.id)) ?? '',
        changedFiles: files,
        signal,
      };
      // An OpenRouter model runs there; if that fails, one Claude call takes over (P-26).
      const judgedBy = await judgeWithFallback(
        { claude: deps.judge, openRouter: deps.openRouterJudge },
        input,
      );
      judgeFallback = judgedBy.fallback;
      // Both providers get the same message.
      const sent = judgeRequest(input).messages[0]?.content;
      for (const call of judgedBy.calls) {
        sessions.push({
          role: 'judge',
          model: call.model,
          prompt: typeof sent === 'string' ? sent : JSON.stringify(sent),
          result: call.result,
        });
      }
      const { result } = judgedBy;
      if (result.status !== 'completed' || !result.output) {
        const error = result.error ?? { code: 'agent_failed', params: {} };
        return {
          status: 'failed',
          error: {
            code: error.code === 'output_invalid' ? 'judge_output_invalid' : error.code,
            params: error.params,
          },
          sessions,
          ...(judgeFallback ? { output: { judgeFallback } } : {}),
        };
      }
      judged = result.output;
    }
  }

  const raised = raiseChangeType(floor.changeType, judged?.changeType ?? null, forced);
  const output: ChangeTypeOutput = {
    changeType: raised.changeType,
    reason: raised.reason,
    rules: { changeType: floor.changeType, reason: floor.reason },
    judge: judged,
    judgeSkipped,
    judgeFallback,
    forced,
    needsPerson: needsPerson(raised.changeType, raised.rulesPicked).needed,
    lines: floor.lines,
    largePr: floor.lines > config.largePrLines,
    largePrLines: config.largePrLines,
  };
  return { status: 'succeeded', output, sessions, findings: [], questions: [], notChecked: [] };
}

/** The change type the run's Change type stage set, or null (level 1, or no stage yet). */
export async function changeTypeOfRun(db: Db, runId: number): Promise<ChangeTypeOutput | null> {
  return (await succeededStageOutput(db, runId, 'change_type')) as ChangeTypeOutput | null;
}

/** One English sentence for the reviewer's brief: why the PR has its change type. */
export function changeTypeWhy(output: ChangeTypeOutput): string {
  if (output.forced) return 'A person set this change type for the PR.';
  if (output.judge && output.reason.code === 'judge_raised') return output.judge.reason;
  const { reason } = output.rules;
  switch (reason.code) {
    case 'sensitive_one_way':
      return `It touches ${reason.params.path}: ${reason.params.reason}`;
    case 'path_one_way':
      return `It touches ${reason.params.path}, a path that is hard to undo.`;
    case 'size_over_threshold':
      return `${reason.params.lines} changed lines, over the ${reason.params.threshold}-line threshold.`;
    case 'paths_uses_existing':
      return 'Every changed file is documentation, tests or similar.';
    case 'paths_change_behaviour':
      return `It changes ${reason.params.path}, which decides how the product behaves.`;
    default:
      return output.judge?.reason ?? '';
  }
}
