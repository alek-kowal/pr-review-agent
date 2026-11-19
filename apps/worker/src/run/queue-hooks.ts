// S-10-T3: a run that ends frees its agent slot, so the queue drainer (`drain.ts`) is woken.
import { sendDrainJob } from '@pra/db';
import type { RunHook } from './hooks.ts';

export const wakeQueueOnRunEnd: RunHook = async ({ deps }) => {
  await sendDrainJob(deps.queue);
};
