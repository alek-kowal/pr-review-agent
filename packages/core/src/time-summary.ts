import type { RunStatus } from './model.ts';
import { laneOf, LANES, type Lane, type PrState } from './pr-state.ts';

/** One row of the PR's state-change log. */
export interface StateChange {
  state: PrState;
  at: Date;
}

export interface TimeSummary {
  /** The first state after which the PR waits on a review (not a draft); null before that. */
  readyAt: Date | null;
  /** How the PR ended; `open` while it is open (then the span runs until `now`). */
  outcome: 'open' | 'merged' | 'closed';
  /** Ready → merged, ready → closed, or open for. */
  totalMs: number;
  /** Time in the Agents working lane (the queue included). */
  agentsWorkedMs: number;
  /** Time in every other lane: waiting for people and for the merge click. */
  waitingMs: number;
  byLane: Record<Lane, number>;
  /** Cost of the PR's finished runs. */
  costUsd: number;
}

const FINISHED: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

const noLanes = (): Record<Lane, number> =>
  Object.fromEntries(LANES.map((lane) => [lane, 0])) as Record<Lane, number>;

/**
 * The Timeline tab's summary (metric 2, "Ready → merge"): time from the first ready-for-review
 * state to the merge (or close, or now), split by the board lane the PR was in, and the cost of
 * finished runs. Time while the PR was closed counts toward no lane.
 */
export function timeSummary(
  stateChanges: readonly StateChange[],
  runs: readonly { status: RunStatus; costUsd: number }[],
  now: Date,
): TimeSummary {
  const costUsd = runs
    .filter((run) => FINISHED.includes(run.status))
    .reduce((sum, run) => sum + run.costUsd, 0);
  const changes = [...stateChanges].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = changes.findIndex((c) => c.state !== 'draft' && laneOf(c.state) !== null);
  const byLane = noLanes();
  if (first === -1) {
    return {
      readyAt: null,
      outcome: 'open',
      totalMs: 0,
      agentsWorkedMs: 0,
      waitingMs: 0,
      byLane,
      costUsd,
    };
  }

  const last = changes[changes.length - 1]!;
  const outcome = last.state === 'merged' || last.state === 'closed' ? last.state : 'open';
  const end = outcome === 'open' ? now : last.at;
  for (let i = first; i < changes.length; i++) {
    const lane = laneOf(changes[i]!.state);
    if (!lane) continue;
    const until = i + 1 < changes.length ? changes[i + 1]!.at : end;
    byLane[lane] += Math.max(0, until.getTime() - changes[i]!.at.getTime());
  }
  const readyAt = changes[first]!.at;
  const agentsWorkedMs = byLane.agents_working;
  return {
    readyAt,
    outcome,
    totalMs: Math.max(0, end.getTime() - readyAt.getTime()),
    agentsWorkedMs,
    waitingMs: byLane.not_reviewed + byLane.action_needed + byLane.ready_to_merge,
    byLane,
    costUsd,
  };
}
