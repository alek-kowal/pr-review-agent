import { describe, expect, it } from 'vitest';
import { timeSummary, type StateChange } from '../src/index.ts';

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.UTC(2026, 10, 19, 8) + hours * HOUR);
const change = (state: StateChange['state'], hours: number): StateChange => ({
  state,
  at: at(hours),
});

describe('timeSummary', () => {
  it('splits ready → merge by lane from the state changes', () => {
    const summary = timeSummary(
      [
        change('draft', 0),
        change('queued', 1), // ready for review: the round is queued
        change('round_running', 1.5),
        change('findings_to_decide', 2),
        change('ready_to_merge', 5),
        change('merged', 7),
      ],
      [],
      at(100),
    );
    expect(summary).toMatchObject({
      readyAt: at(1),
      outcome: 'merged',
      totalMs: 6 * HOUR,
      agentsWorkedMs: 1 * HOUR,
      waitingMs: 5 * HOUR,
    });
    expect(summary.byLane).toEqual({
      not_reviewed: 0,
      agents_working: 1 * HOUR,
      action_needed: 3 * HOUR,
      ready_to_merge: 2 * HOUR,
    });
  });

  it('an open PR is measured until now; never reviewed counts as waiting', () => {
    const summary = timeSummary(
      [change('never_reviewed', 0), change('round_running', 2)],
      [],
      at(3),
    );
    expect(summary).toMatchObject({
      readyAt: at(0),
      outcome: 'open',
      totalMs: 3 * HOUR,
      agentsWorkedMs: 1 * HOUR,
      waitingMs: 2 * HOUR,
    });
  });

  it('time while the PR was closed counts toward no lane', () => {
    const summary = timeSummary(
      [
        change('never_reviewed', 0),
        change('closed', 1),
        change('never_reviewed', 4),
        change('closed', 5),
      ],
      [],
      at(10),
    );
    expect(summary).toMatchObject({ outcome: 'closed', totalMs: 5 * HOUR, waitingMs: 2 * HOUR });
  });

  it('a PR that was never ready has no summary times', () => {
    const summary = timeSummary([change('draft', 0)], [], at(5));
    expect(summary).toMatchObject({ readyAt: null, totalMs: 0, agentsWorkedMs: 0 });
  });

  it('sums the cost of finished runs only', () => {
    const summary = timeSummary(
      [change('round_running', 0)],
      [
        { status: 'completed', costUsd: 1.25 },
        { status: 'failed', costUsd: 0.5 },
        { status: 'cancelled', costUsd: 0.25 },
        { status: 'running', costUsd: 0.75 },
        { status: 'queued', costUsd: 0 },
      ],
      at(1),
    );
    expect(summary.costUsd).toBe(2);
  });
});
