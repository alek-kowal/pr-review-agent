// S-16-T3: the steps a fork's round runs without (install in Checks, reproductions in Verify), as
// the core plan marks them (`forkOffSteps`), so the stepper and Run detail say "off for forks".
import { forkOffSteps, type Reason } from '@pra/core';
import type { Run } from '@pra/db';

export type OffStepView = { step: string; reason: Reason };

const isRound = (kind: Run['kind']) => kind === 'round' || kind === 'trial';

/** The off steps of one stage of `run`: none for a non-fork, another run kind or an off stage. */
export function offStepsOf(
  run: Pick<Run, 'kind'>,
  fork: boolean,
  stage: { key: string; status: string },
): OffStepView[] {
  if (!fork || !isRound(run.kind) || stage.status === 'off') return [];
  return forkOffSteps([stage.key]).map(({ step, reason }) => ({ step, reason }));
}
