// S-08-T7 (FR-043): when a full review completes, the team's opinions on the previous review's
// findings move along to the matching new findings, marked "from round N".
import { carryOpinions } from '@pra/db';
import type { RunHook } from './hooks.ts';

export const carryOpinionsOnRunCompleted: RunHook = async ({ deps, run }) => {
  const copied = await carryOpinions(deps.db, run);
  if (copied > 0) deps.logger.info({ runId: run.id, copied }, 'opinions carried to new findings');
};
