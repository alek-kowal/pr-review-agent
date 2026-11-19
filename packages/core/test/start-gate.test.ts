import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, queueCauseOf, startGate, type GateStatus } from '../src/index.ts';

const TOMEK = '6f1c2a54-0000-4000-8000-000000000001';
const running: GateStatus = { ...DEFAULT_APP_SETTINGS, dailyBudgetUsd: 50 };
const paused: GateStatus = {
  ...running,
  paused: true,
  pausedBy: TOMEK,
  pausedReason: 'release freeze',
};
const busy = [{ prNumber: 270 }, { prNumber: 277 }];

describe('startGate', () => {
  it('starts a round when running, under budget, with a free slot', () => {
    expect(startGate({ status: running, spentToday: 12.4, activeRuns: [], kind: 'round' })).toEqual(
      {
        start: true,
      },
    );
  });

  it('queues a new round while paused, naming who paused and why', () => {
    expect(startGate({ status: paused, spentToday: 0, activeRuns: [], kind: 'round' })).toEqual({
      start: false,
      reason: {
        code: 'paused',
        params: { by: { kind: 'member', memberId: TOMEK }, note: 'release freeze' },
      },
    });
  });

  it('lets a session inside a running round go on while paused', () => {
    expect(startGate({ status: paused, spentToday: 0, activeRuns: busy, kind: 'session' })).toEqual(
      { start: true },
    );
  });

  it('queues rounds and holds every session once the spend reaches the budget', () => {
    const wait = {
      start: false,
      reason: { code: 'budget_reached', params: { spentUsd: 50, budgetUsd: 50 } },
    };
    expect(startGate({ status: running, spentToday: 50, activeRuns: [], kind: 'round' })).toEqual(
      wait,
    );
    expect(startGate({ status: running, spentToday: 50, activeRuns: [], kind: 'session' })).toEqual(
      wait,
    );
    expect(
      startGate({ status: running, spentToday: 49.99, activeRuns: [], kind: 'session' }),
    ).toEqual({ start: true });
  });

  it('a session over budget waits even while paused (budget, not pause)', () => {
    const decision = startGate({ status: paused, spentToday: 60, activeRuns: [], kind: 'session' });
    expect(decision).toMatchObject({ start: false, reason: { code: 'budget_reached' } });
  });

  it('no budget never holds', () => {
    const status = { ...running, dailyBudgetUsd: null };
    expect(startGate({ status, spentToday: 1_000, activeRuns: [], kind: 'session' })).toEqual({
      start: true,
    });
  });

  it('queues a round when both agent slots are busy, with the busy PRs', () => {
    expect(startGate({ status: running, spentToday: 0, activeRuns: busy, kind: 'round' })).toEqual({
      start: false,
      reason: { code: 'slots_busy', params: { slots: 2, prs: [270, 277] } },
    });
    expect(
      startGate({ status: running, spentToday: 0, activeRuns: [busy[0]!], kind: 'round' }),
    ).toEqual({ start: true });
  });

  it('a free slot goes to the older queued runs first', () => {
    const one = [busy[0]!];
    expect(
      startGate({ status: running, spentToday: 0, activeRuns: one, kind: 'round', queuedAhead: 1 }),
    ).toMatchObject({ start: false, reason: { code: 'slots_busy' } });
    const three = { ...running, agentSlots: 3 };
    expect(
      startGate({ status: three, spentToday: 0, activeRuns: one, kind: 'round', queuedAhead: 1 }),
    ).toEqual({ start: true });
  });

  it('a paused factory reports paused before the budget and the slots', () => {
    const decision = startGate({ status: paused, spentToday: 99, activeRuns: busy, kind: 'round' });
    expect(decision).toMatchObject({ start: false, reason: { code: 'paused' } });
  });
});

describe('queueCauseOf', () => {
  it('maps each stored wait reason to the PR state queue cause', () => {
    const wait = (status: GateStatus, spent: number, activeRuns = busy) => {
      const decision = startGate({ status, spentToday: spent, activeRuns, kind: 'round' });
      return decision.start ? null : decision.reason;
    };
    expect(queueCauseOf(wait(paused, 0))).toEqual({
      cause: 'paused',
      by: { kind: 'member', memberId: TOMEK },
      note: 'release freeze',
    });
    expect(queueCauseOf(wait(running, 50))).toEqual({
      cause: 'budget',
      spentUsd: 50,
      budgetUsd: 50,
    });
    expect(queueCauseOf(wait(running, 0))).toEqual({ cause: 'slot' });
    expect(queueCauseOf(null)).toEqual({ cause: 'slot' });
  });
});
