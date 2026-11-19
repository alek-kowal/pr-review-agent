// S-16-T3: why a stage or a step inside it is off, shared by the stepper and Run detail. A fork's
// plan turns the steps that run PR code off ("off for forks"); a level turns whole stages off.
import { copy } from '@/copy/index.ts';
import type { OffStepView, ReasonView } from '@/lib/api-types.ts';
import { reasonText } from '@/lib/reasons.ts';

export const isForkOff = (reason: ReasonView | null): boolean => reason?.code === 'fork_read_only';

/** An off stage's short line: "off for forks" or "off at level 2". */
export const offStageText = (offReason: ReasonView | null, level: number): string =>
  isForkOff(offReason) ? reasonText('fork_read_only') : copy.runs.step.off(level);

/** Each off step inside a stage: "Install: off for forks". */
export const offStepTexts = (offSteps: readonly OffStepView[]): string[] =>
  offSteps.map((off) => copy.runs.offStep(off.step, reasonText(off.reason.code)));
