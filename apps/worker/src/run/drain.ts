// S-10-T3: the queue drainer (`run.drain`). Woken after every status change (the api), when a
// run ends (a slot frees: run hooks), and by a cron every minute (which also covers local
// midnight, when today's spend starts again). Under the agent queue's lock it lets the oldest
// waiting runs take the free slots, refreshes why the others wait, and lets started runs that
// waited before an agent session go on; then it sends their stage jobs, whose gates confirm.
import {
  admitRun,
  clearRunWait,
  getRun,
  lockAgentQueue,
  runsWaitingForSession,
  runsWaitingToStart,
  setRunWait,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { decide, readQueueState } from './budget-gate.ts';
import { sendPendingStageJob } from './recover.ts';

export type DrainResult = { started: number[]; resumed: number[] };

export async function drainQueue(deps: Pick<WorkerDeps, 'db' | 'queue'>): Promise<DrainResult> {
  const result = await deps.db.transaction(async (tx) => {
    await lockAgentQueue(tx);
    const state = await readQueueState(tx);
    const started: number[] = [];
    for (const waiting of await runsWaitingToStart(tx)) {
      const decision = decide(state, { id: waiting.runId }, 'round');
      if (decision.start) {
        await admitRun(tx, waiting.runId);
        state.holders.push(waiting);
        started.push(waiting.runId);
      } else {
        await setRunWait(tx, waiting.runId, decision.reason, 'start');
      }
    }
    const resumed: number[] = [];
    for (const waiting of await runsWaitingForSession(tx)) {
      const decision = decide(state, { id: waiting.runId }, 'session');
      if (decision.start) {
        await clearRunWait(tx, waiting.runId);
        resumed.push(waiting.runId);
      } else {
        await setRunWait(tx, waiting.runId, decision.reason, 'session');
      }
    }
    return { started, resumed };
  });

  for (const runId of [...result.started, ...result.resumed]) {
    const run = await getRun(deps.db, runId);
    if (run) await sendPendingStageJob(deps, run);
  }
  return result;
}
