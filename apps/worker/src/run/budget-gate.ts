// S-10-T3: pause, daily budget and agent slots as start gates (P-05's `beforeRoundStart` and
// `beforeSession`). Each decision runs under the agent queue's advisory lock: it reads the status,
// today's spend and the slot holders, then either lets the run through (claiming its slot) or
// stores why it waits. The drainer (`drain.ts`) sends the stage job again once the reason clears.
import { holdReason, startGate, type GateKind, type StartGateDecision } from '@pra/core';
import {
  admitRun,
  clearRunWait,
  getAppSettings,
  lockAgentQueue,
  queuedAheadOf,
  setRunWait,
  slotHolders,
  spentToday,
  type Executor,
  type Run,
} from '@pra/db';
import type { RunGate } from './gates.ts';

type QueueState = Awaited<ReturnType<typeof readQueueState>>;

/** Status, today's spend and the slot holders; call under `lockAgentQueue`. */
export async function readQueueState(tx: Executor) {
  const status = (await getAppSettings(tx)).value;
  const spent = await spentToday(tx, { timeZone: status.timeZone });
  return { status, spentUsd: spent.spentUsd, holders: await slotHolders(tx) };
}

/**
 * Whether the agent is paused or today's budget is reached right now. The bot's own push reads
 * it (no lock: it claims no slot), so a pause or a budget stops autofix before it writes to a PR.
 */
export async function autofixHolds(
  db: Executor,
): Promise<{ paused: boolean; budgetReached: boolean }> {
  const status = (await getAppSettings(db)).value;
  const spent = await spentToday(db, { timeZone: status.timeZone });
  const hold = holdReason(status, spent.spentUsd);
  return { paused: hold?.code === 'paused', budgetReached: hold?.code === 'budget_reached' };
}

/** The decision for one run, against a state read under the lock. */
export function decide(
  state: QueueState,
  run: Pick<Run, 'id'>,
  kind: GateKind,
  queuedAhead = 0,
): StartGateDecision {
  return startGate({
    status: state.status,
    spentToday: state.spentUsd,
    activeRuns: state.holders.filter((holder) => holder.runId !== run.id),
    kind,
    queuedAhead,
  });
}

/** Before a queued run starts: paused, budget, then a free slot (older queued runs first). */
export const queueRoundGate: RunGate = async ({ deps, run }) =>
  deps.db.transaction(async (tx) => {
    await lockAgentQueue(tx);
    const state = await readQueueState(tx);
    const decision = decide(state, run, 'round', await queuedAheadOf(tx, run));
    if (decision.start) await admitRun(tx, run.id);
    else await setRunWait(tx, run.id, decision.reason, 'start');
    return decision;
  });

/** Before every agent stage: the daily budget (a pause lets started rounds finish). */
export const queueSessionGate: RunGate = async ({ deps, run }) =>
  deps.db.transaction(async (tx) => {
    await lockAgentQueue(tx);
    const decision = decide(await readQueueState(tx), run, 'session');
    if (decision.start) await clearRunWait(tx, run.id);
    else await setRunWait(tx, run.id, decision.reason, 'session');
    return decision;
  });
