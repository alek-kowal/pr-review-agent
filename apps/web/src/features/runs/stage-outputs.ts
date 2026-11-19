import type { ComponentType } from 'react';
import type { RunDetail, RunStageView } from '@/lib/api-types.ts';
import { ChangeTypeOutput, ChecksOutput } from '@/features/checks/CheckOutputs.tsx';
import { ReviewOutput, TaskOutput } from './StageOutputs.tsx';

export type StageOutputProps = { output: unknown; stage: RunStageView; run: RunDetail };

/**
 * How Run detail shows a finished stage's stored output, by stage key (extension point from
 * P-12: S-04-T6/T7 add Checks and Change type with one line). A stage without an entry shows its
 * output as keys and values.
 */
export const STAGE_OUTPUTS: Record<string, ComponentType<StageOutputProps>> = {
  checks: ChecksOutput,
  task: TaskOutput,
  change_type: ChangeTypeOutput,
  review: ReviewOutput,
};
