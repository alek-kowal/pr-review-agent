import { describe, expect, it } from 'vitest';
import {
  alertCommentText,
  alertConditions,
  AlertConfigSchema,
  AlertConfigWriteSchema,
  DEFAULT_ALERT_CONFIG,
  reconcileAlerts,
  type AlertConfig,
  type AlertPrSnapshot,
  type AlertSnapshot,
  type KnownAlert,
} from '../src/index.ts';

const DAY = '2026-11-19';

const pr = (over: Partial<AlertPrSnapshot> = {}): AlertPrSnapshot => ({
  prId: 'pr-1',
  number: 262,
  failure: null,
  roundsUsedChain: null,
  spentUsd: 1,
  ...over,
});

const snapshot = (over: Partial<AlertSnapshot> = {}): AlertSnapshot => ({
  day: DAY,
  spentTodayUsd: 0,
  dailyBudgetUsd: 50,
  prs: [pr()],
  ...over,
});

const config = (over: Partial<AlertConfig> = {}): AlertConfig => ({
  ...DEFAULT_ALERT_CONFIG,
  ...over,
});

const failure = { no: 1, stage: 'review' as const, errorCode: 'stage_timeout', timeoutMinutes: 30 };

/** Stores what fired and applies the clears, as the worker does. */
function step(known: KnownAlert[], snap: AlertSnapshot, cfg: AlertConfig = config()) {
  const changes = reconcileAlerts(known, alertConditions(snap, cfg));
  const next = known.map((a) =>
    changes.resolve.some((r) => r.key === a.key) ? { ...a, status: 'resolved' as const } : a,
  );
  for (const f of changes.fire) {
    next.push({ key: f.key, kind: f.kind, prId: f.prId, status: 'active' });
  }
  return { changes, known: next };
}

describe('alert config', () => {
  it('defaults to every alert on, $5 per PR and 80% of the budget', () => {
    expect(DEFAULT_ALERT_CONFIG).toEqual({
      failedOn: true,
      roundsOn: true,
      costOn: true,
      costMaxUsd: 5,
      budgetOn: true,
      budgetPercent: 80,
      generalTaskId: null,
    });
  });

  it('refuses a cost of 0 or less and a budget percent off the list', () => {
    expect(AlertConfigSchema.safeParse({ costMaxUsd: 0 }).success).toBe(false);
    expect(AlertConfigSchema.safeParse({ costMaxUsd: -1 }).success).toBe(false);
    expect(AlertConfigSchema.safeParse({ budgetPercent: 75 }).success).toBe(false);
    expect(AlertConfigSchema.safeParse({ budgetPercent: 90 }).success).toBe(true);
  });

  it('requires the general alerts task when Settings saves', () => {
    expect(AlertConfigWriteSchema.safeParse({ generalTaskId: ' ' }).success).toBe(false);
    expect(AlertConfigWriteSchema.parse({ generalTaskId: ' WB-700 ' }).generalTaskId).toBe(
      'WB-700',
    );
  });
});

describe('run failed', () => {
  it('fires when a stage timed out, with Retry from the stage', () => {
    const { changes } = step([], snapshot({ prs: [pr({ failure })] }));
    expect(changes.fire).toEqual([
      {
        kind: 'failed',
        key: 'failed:pr-1:1',
        prId: 'pr-1',
        title: {
          code: 'alert_failed',
          params: {
            prNumber: 262,
            stage: 'review',
            errorCode: 'stage_timeout',
            timeoutMinutes: 30,
          },
        },
        nextStep: { code: 'alert_next_retry', params: { stage: 'review' } },
      },
    ]);
  });

  it('clears when a retry or a new review starts', () => {
    const fired = step([], snapshot({ prs: [pr({ failure })] }));
    const { changes } = step(fired.known, snapshot({ prs: [pr()] }));
    expect(changes.fire).toEqual([]);
    expect(changes.resolve).toEqual([
      { key: 'failed:pr-1:1', note: { code: 'alert_end_retried', params: {} } },
    ]);
  });

  it('fires again for the next failure of the same PR', () => {
    const first = step([], snapshot({ prs: [pr({ failure })] }));
    const retried = step(first.known, snapshot());
    const second = step(retried.known, snapshot({ prs: [pr({ failure: { ...failure, no: 2 } })] }));
    expect(second.changes.fire.map((f) => f.key)).toEqual(['failed:pr-1:2']);
  });
});

describe('automatic rounds used', () => {
  it('fires when a chain used 3 of 3 with a fix still open', () => {
    const { changes } = step([], snapshot({ prs: [pr({ roundsUsedChain: 'c-1' })] }));
    expect(changes.fire).toMatchObject([
      {
        kind: 'rounds',
        key: 'rounds:pr-1:c-1',
        title: { code: 'alert_rounds', params: { prNumber: 262, max: 3 } },
        nextStep: { code: 'alert_next_start_review' },
      },
    ]);
  });

  it('clears when a new review starts', () => {
    const fired = step([], snapshot({ prs: [pr({ roundsUsedChain: 'c-1' })] }));
    const { changes } = step(fired.known, snapshot());
    expect(changes.resolve).toEqual([
      { key: 'rounds:pr-1:c-1', note: { code: 'alert_end_new_review', params: {} } },
    ]);
  });
});

describe('cost of one PR', () => {
  it('fires when real spend passes the threshold', () => {
    expect(step([], snapshot({ prs: [pr({ spentUsd: 5 })] })).changes.fire).toEqual([]);
    const { changes } = step([], snapshot({ prs: [pr({ spentUsd: 5.84 })] }));
    expect(changes.fire).toMatchObject([
      {
        kind: 'cost',
        key: 'cost:pr-1',
        title: { code: 'alert_cost', params: { prNumber: 262, spentUsd: 5.84, maxUsd: 5 } },
        nextStep: { code: 'alert_next_split' },
      },
    ]);
  });

  it('never clears by itself, even when the condition is gone', () => {
    const fired = step([], snapshot({ prs: [pr({ spentUsd: 6 })] }));
    const higher = step(
      fired.known,
      snapshot({ prs: [pr({ spentUsd: 4 })] }),
      config({ costMaxUsd: 10 }),
    );
    expect(higher.changes.resolve).toEqual([]);
    const closed = step(fired.known, snapshot({ prs: [] }));
    expect(closed.changes.resolve).toEqual([]);
  });

  it('does not fire again for that PR after a dismiss', () => {
    const dismissed: KnownAlert[] = [
      { key: 'cost:pr-1', kind: 'cost', prId: 'pr-1', status: 'dismissed' },
    ];
    const { changes } = step(dismissed, snapshot({ prs: [pr({ spentUsd: 9 })] }));
    expect(changes.fire).toEqual([]);
  });
});

describe('daily budget', () => {
  it('fires when spend passes the threshold, and again at 100%', () => {
    const below = step([], snapshot({ spentTodayUsd: 39.99 }));
    expect(below.changes.fire).toEqual([]);
    const at80 = step(below.known, snapshot({ spentTodayUsd: 40 }));
    expect(at80.changes.fire).toMatchObject([
      {
        kind: 'budget',
        key: `budget:${DAY}:80`,
        prId: null,
        title: { code: 'alert_budget', params: { percent: 80, spentUsd: 40, budgetUsd: 50 } },
        nextStep: { code: 'alert_next_budget' },
      },
    ]);
    const at100 = step(at80.known, snapshot({ spentTodayUsd: 50 }));
    expect(at100.changes.fire.map((f) => f.key)).toEqual([`budget:${DAY}:100`]);
    expect(at100.changes.resolve).toEqual([]);
  });

  it('clears when spend falls below the threshold', () => {
    const fired = step([], snapshot({ spentTodayUsd: 45 }));
    const raised = step(fired.known, snapshot({ spentTodayUsd: 45, dailyBudgetUsd: 100 }));
    expect(raised.changes.resolve).toEqual([
      { key: `budget:${DAY}:80`, note: { code: 'alert_end_below_threshold', params: {} } },
    ]);
  });

  it('clears at midnight', () => {
    const fired = step([], snapshot({ spentTodayUsd: 50 }));
    expect(fired.known.map((a) => a.key)).toEqual([`budget:${DAY}:80`, `budget:${DAY}:100`]);
    const midnight = step(fired.known, snapshot({ day: '2026-11-20', spentTodayUsd: 0 }));
    expect(midnight.changes.resolve).toEqual([
      { key: `budget:${DAY}:80`, note: { code: 'alert_end_midnight', params: {} } },
      { key: `budget:${DAY}:100`, note: { code: 'alert_end_midnight', params: {} } },
    ]);
  });

  it('never fires without a budget', () => {
    expect(step([], snapshot({ spentTodayUsd: 99, dailyBudgetUsd: null })).changes.fire).toEqual(
      [],
    );
    expect(step([], snapshot({ spentTodayUsd: 99, dailyBudgetUsd: 0 })).changes.fire).toEqual([]);
  });
});

describe('every alert', () => {
  const wrong = snapshot({
    spentTodayUsd: 50,
    prs: [pr({ failure, roundsUsedChain: 'c-1', spentUsd: 9 })],
  });

  it('a disabled alert kind never fires', () => {
    const off = config({ failedOn: false, roundsOn: false, costOn: false, budgetOn: false });
    expect(step([], wrong, off).changes.fire).toEqual([]);
    expect(step([], wrong, config({ costOn: false })).changes.fire.map((f) => f.kind)).toEqual([
      'failed',
      'rounds',
      'budget',
      'budget',
    ]);
  });

  it('switching a kind off leaves its active alerts as they are', () => {
    const fired = step([], wrong);
    const off = step(fired.known, snapshot({ prs: [pr()] }), config({ failedOn: false }));
    expect(off.changes.resolve.map((r) => r.key)).not.toContain('failed:pr-1:1');
  });

  it('a key never fires twice', () => {
    const first = step([], wrong);
    expect(first.changes.fire).toHaveLength(5);
    expect(step(first.known, wrong).changes.fire).toEqual([]);
    const resolved = first.known.map((a) => ({ ...a, status: 'resolved' as const }));
    expect(step(resolved, wrong).changes.fire).toEqual([]);
  });

  it('nothing fires when things go well, and a clear says nothing', () => {
    expect(step([], snapshot()).changes).toEqual({ fire: [], resolve: [] });
  });

  it('clears the alerts of a PR that closed', () => {
    const fired = step([], snapshot({ prs: [pr({ failure })] }));
    const { changes } = step(fired.known, snapshot({ prs: [] }));
    expect(changes.resolve).toEqual([
      { key: 'failed:pr-1:1', note: { code: 'alert_end_pr_closed', params: {} } },
    ]);
  });
});

describe('alertCommentText', () => {
  it('names the problem and the next step, links to the app and is signed by the bot', () => {
    const [failed] = alertConditions(snapshot({ prs: [pr({ failure })] }), config()).items;
    expect(
      alertCommentText({
        title: failed!.title,
        nextStep: failed!.nextStep,
        prNumber: 262,
        link: 'https://pra.example/pr/acme/web/262',
      }),
    ).toBe(
      [
        'PR Review Agent alert · PR #262',
        'Review stage timed out after 30 min.',
        'Next step: Retry from Review.',
        'Open in PR Review Agent: https://pra.example/pr/acme/web/262',
        '— pr-review-agent',
      ].join('\n'),
    );
  });

  it('heads a budget alert with the daily budget', () => {
    const [budget] = alertConditions(snapshot({ spentTodayUsd: 40 }), config()).items;
    expect(
      alertCommentText({
        title: budget!.title,
        nextStep: budget!.nextStep,
        prNumber: null,
        link: 'https://pra.example/activity',
      }),
    ).toContain('Daily budget 80% used: $40.00 of $50.00.\nNext step: Pause, raise the budget');
  });
});
