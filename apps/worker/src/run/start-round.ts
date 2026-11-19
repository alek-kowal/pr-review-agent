// The worker's round start (S-07-T1): the ready webhook and fix pushes start rounds through
// `@pra/db` `startRound`, which the API's manual start shares; `createRun` sits under it.
import { startRound as startRoundInDb, type StartRoundInput, type StartRoundResult } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';

export type { StartRoundInput, StartRoundResult };

export function startRound(
  deps: Pick<WorkerDeps, 'db' | 'queue' | 'logger'>,
  input: StartRoundInput,
): Promise<StartRoundResult> {
  return startRoundInDb(deps, input);
}
