// Stage executors by stage key (P-05 extension point). P-09 adds Checks, Task, Change type and
// Verify, P-18 the implementer stages: add a file and a line here. A planned stage with no
// executor fails with `stage_not_available`.
import { checksStage } from './checks.ts';
import { reviewStage } from './review/index.ts';
import type { StageExecutor } from './stage.ts';

export type StageExecutors = Readonly<Record<string, StageExecutor>>;

export const STAGE_EXECUTORS: StageExecutors = {
  [checksStage.key]: checksStage,
  [reviewStage.key]: reviewStage,
};
