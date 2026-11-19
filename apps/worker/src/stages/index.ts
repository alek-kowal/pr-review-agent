// Stage executors by stage key (P-05 extension point). P-09 adds Checks, Task, Change type and
// Verify, P-18 the implementer stages: add a file and a line here. A planned stage with no
// executor fails with `stage_not_available`.
import { changeTypeStage } from './change-type.ts';
import { checksStage } from './checks.ts';
import { checkFixesStage, fixDiffStage, reproductionsStage } from './fix-check.ts';
import {
  implementStage,
  implementerReproductionsStage,
  implementerWorktreeStage,
} from './implementer.ts';
import { reviewStage } from './review/index.ts';
import { taskStage } from './task.ts';
import type { StageExecutor } from './stage.ts';
import { verifyStage } from './verify.ts';

export type StageExecutors = Readonly<Record<string, StageExecutor>>;

export const STAGE_EXECUTORS: StageExecutors = {
  [checksStage.key]: checksStage,
  [taskStage.key]: taskStage,
  [changeTypeStage.key]: changeTypeStage,
  [reviewStage.key]: reviewStage,
  [verifyStage.key]: verifyStage,
  [fixDiffStage.key]: fixDiffStage,
  [checkFixesStage.key]: checkFixesStage,
  [reproductionsStage.key]: reproductionsStage,
  // Executors of one run kind are keyed `<kind>:<stage>` and win over the shared stage key.
  'implementer:worktree': implementerWorktreeStage,
  'implementer:implement': implementStage,
  'implementer:reproductions': implementerReproductionsStage,
};

/** The executor of a run kind's stage: the kind's own first, then the shared one. */
export const executorFor = (executors: StageExecutors, kind: string, stage: string) =>
  executors[`${kind}:${stage}`] ?? executors[stage];
