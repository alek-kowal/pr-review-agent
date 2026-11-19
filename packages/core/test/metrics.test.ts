// S-19-T2: the five pilot metrics over PR histories (docs/06-metrics.md).
import { describe, expect, test } from 'vitest';
import {
  isBaseMerge,
  median,
  pilotMetrics,
  prMetrics,
  type PrHistory,
  type PrState,
} from '../src/index.ts';

const H = 3_600_000;
const t0 = new Date('2026-11-02T08:00:00Z');
const at = (hours: number) => new Date(t0.getTime() + hours * H);
const sha = (c: string) => c.repeat(40);

/** A merged PR: ready at t0, one round, Ready to merge at 6 h, merged at 10 h at head `a`. */
function history(over: Partial<PrHistory> = {}): PrHistory {
  return {
    outcome: 'merged',
    readyAt: at(0),
    mergedAt: at(10),
    mergedHeadSha: sha('a'),
    runs: [{ kind: 'round', status: 'completed' }],
    stages: [{ runKind: 'round', startedAt: at(1), finishedAt: at(2) }],
    sessions: [{ runKind: 'round', costUsd: 0.5, tokens: 1000 }],
    stateChanges: states([
      ['queued', 0],
      ['round_running', 1],
      ['findings_to_decide', 2],
      ['ready_to_merge', 6],
      ['merged', 10],
    ]),
    headChanges: [],
    ...over,
  };
}

function states(rows: [PrState, number, string?][]): PrHistory['stateChanges'] {
  return rows.map(([state, hours, head = sha('a')]) => ({ state, headSha: head, at: at(hours) }));
}

describe('metric 1: agent work per PR', () => {
  test('sums stage durations; queue excluded, failed stages counted, trials excluded', () => {
    const pr = prMetrics(
      history({
        // Queued for 5 hours before the first stage: the queue is not a stage.
        stateChanges: states([
          ['queued', 0],
          ['round_running', 5],
          ['findings_to_decide', 7],
          ['merged', 10],
        ]),
        runs: [
          { kind: 'round', status: 'failed' },
          { kind: 'round', status: 'completed' },
          { kind: 'trial', status: 'completed' },
        ],
        stages: [
          // A failed stage of the failed round counts.
          { runKind: 'round', startedAt: at(5), finishedAt: at(5.5) },
          { runKind: 'round', startedAt: at(6), finishedAt: at(7) },
          { runKind: 'implementer', startedAt: at(8), finishedAt: at(8.25) },
          // Still running: no end, nothing counted yet.
          { runKind: 'round', startedAt: at(9), finishedAt: null },
          { runKind: 'trial', startedAt: at(6), finishedAt: at(9) },
        ],
      }),
    );
    expect(pr.agentWorkMs).toBe(1.75 * H);
  });

  test('the median over PRs, with the sample size', () => {
    const prs = [1, 2, 4].map((hours) =>
      prMetrics(
        history({ stages: [{ runKind: 'round', startedAt: at(0), finishedAt: at(hours) }] }),
      ),
    );
    expect(pilotMetrics(prs).agentWork).toEqual({ value: 2 * H, sampleSize: 3, tooFew: true });
  });
});

describe('metric 2: ready → merge', () => {
  test('from the first ready to the merge, split into the three lanes', () => {
    const pr = prMetrics(
      history({
        stateChanges: states([
          ['queued', 0],
          ['round_running', 1],
          ['findings_to_decide', 2],
          // Back to draft for an hour: the author's time, so Action needed.
          ['draft', 3],
          ['findings_to_decide', 4],
          ['ready_to_merge', 6],
          ['merged', 10],
        ]),
      }),
    );
    expect(pr.readyToMergeMs).toBe(10 * H);
    expect(pr.lanes).toEqual({ agentsWorking: 2 * H, actionNeeded: 4 * H, readyToMerge: 4 * H });
  });

  test('closed PRs are not in the sample; lanes are summed over merged PRs', () => {
    const closed = prMetrics(history({ outcome: 'closed', mergedAt: null }));
    expect(closed.readyToMergeMs).toBeNull();
    const result = pilotMetrics([prMetrics(history()), prMetrics(history()), closed]);
    expect(result.readyToMerge).toMatchObject({ value: 10 * H, sampleSize: 2 });
    expect(result.readyToMerge.lanes).toEqual({
      agentsWorking: 4 * H,
      actionNeeded: 8 * H,
      readyToMerge: 8 * H,
    });
  });
});

describe('metric 3: cost per PR', () => {
  test('rounds and implementer runs at API rates; trials and the analyst apart', () => {
    const pr = prMetrics(
      history({
        sessions: [
          { runKind: 'round', costUsd: 0.4, tokens: 1000 },
          { runKind: 'implementer', costUsd: 1.1, tokens: 3000 },
          { runKind: 'trial', costUsd: 2, tokens: 5000 },
          { runKind: 'analyst', costUsd: 0.3, tokens: 700 },
        ],
      }),
    );
    expect(pr.costUsd).toBeCloseTo(1.5);
    expect(pr.tokens).toBe(4000);
    expect(pr.trialCostUsd).toBe(2);
    expect(pr.analystCostUsd).toBe(0.3);

    const result = pilotMetrics([pr, prMetrics(history())]);
    expect(result.cost.value).toBeCloseTo(1);
    expect(result.cost).toMatchObject({ sampleSize: 2, trialCostUsd: 2, analystCostUsd: 0.3 });
  });
});

describe('metric 4: not finished after 3 rounds', () => {
  test('counts chains that used 3 of 3 with a fix open, next to PRs with more than 3 rounds', () => {
    const round = { kind: 'round' as const, status: 'completed' as const };
    const usedUp = prMetrics(
      history({
        runs: [round, round, round],
        stateChanges: states([
          ['queued', 0],
          ['rounds_used', 4],
          ['merged', 10],
        ]),
      }),
    );
    // Four rounds over two chains (a manual Start review), never stuck.
    const manyRounds = prMetrics(history({ runs: [round, round, round, round] }));
    expect(usedUp).toMatchObject({ rounds: 3, chainUsedUp: true });
    expect(pilotMetrics([usedUp, manyRounds, prMetrics(history())]).roundsUsedUp).toEqual({
      value: 1,
      sampleSize: 3,
      tooFew: true,
      overThreeRounds: 1,
    });
  });
});

describe('metric 5: ready, then changed by a person', () => {
  const change = (c: string, hours: number, over: { byBot?: boolean; isBaseMerge?: boolean }) => ({
    afterSha: sha(c),
    byBot: false,
    isBaseMerge: false,
    at: at(hours),
    ...over,
  });

  test('a person’s commit after Ready to merge counts; one before it does not', () => {
    const after = prMetrics(
      history({ headChanges: [change('b', 7, {})], mergedHeadSha: sha('b') }),
    );
    const before = prMetrics(
      history({ headChanges: [change('b', 3, {})], mergedHeadSha: sha('a') }),
    );
    expect(after.changedAfterReady).toBe(true);
    expect(before.changedAfterReady).toBe(false);
  });

  test('a base merge and a bot push are ignored', () => {
    const pr = prMetrics(
      history({
        headChanges: [change('b', 7, { isBaseMerge: true }), change('c', 8, { byBot: true })],
        mergedHeadSha: sha('c'),
      }),
    );
    expect(pr).toMatchObject({ changedAfterReady: false, ignoredBaseMerges: 1 });
  });

  test('a merge at another SHA than any head seen after Ready counts', () => {
    expect(prMetrics(history({ mergedHeadSha: sha('f') })).changedAfterReady).toBe(true);
  });

  test('only merged PRs that reached Ready to merge apply; the sample is merged PRs', () => {
    const neverReady = prMetrics(
      history({
        stateChanges: states([
          ['queued', 0],
          ['findings_to_decide', 2],
          ['merged', 10],
        ]),
        mergedHeadSha: sha('f'),
      }),
    );
    expect(neverReady.changedAfterReady).toBeNull();
    const changed = prMetrics(history({ mergedHeadSha: sha('f') }));
    expect(pilotMetrics([neverReady, changed, prMetrics(history())]).changedAfterReady).toEqual({
      value: 1,
      sampleSize: 3,
      tooFew: true,
      ignoredBaseMerges: 0,
    });
  });
});

describe('sample size', () => {
  test('tooFew is true at 9 PRs and false at 10', () => {
    const prs = (n: number) => Array.from({ length: n }, () => prMetrics(history()));
    const nine = pilotMetrics(prs(9));
    const ten = pilotMetrics(prs(10));
    for (const m of [nine.agentWork, nine.readyToMerge, nine.cost, nine.roundsUsedUp]) {
      expect(m).toMatchObject({ sampleSize: 9, tooFew: true });
    }
    expect(nine.changedAfterReady.tooFew).toBe(true);
    for (const m of [ten.agentWork, ten.readyToMerge, ten.cost, ten.roundsUsedUp]) {
      expect(m).toMatchObject({ sampleSize: 10, tooFew: false });
    }
    expect(ten.changedAfterReady.tooFew).toBe(false);
  });

  test('median of an even count is the mean of the two middle values; empty is null', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(pilotMetrics([]).agentWork).toEqual({ value: null, sampleSize: 0, tooFew: true });
  });
});

describe('isBaseMerge', () => {
  const base = { beforeSha: sha('a'), baseSha: sha('b') };
  test('a merge of the base into the old head is a base merge', () => {
    expect(isBaseMerge({ ...base, commit: { parents: [sha('a'), sha('b')], message: 'x' } })).toBe(
      true,
    );
    expect(
      isBaseMerge({
        ...base,
        commit: { parents: [sha('a'), sha('c')], message: "Merge branch 'main' into feature" },
      }),
    ).toBe(true);
  });
  test('an ordinary commit, or a merge on top of another head, is not', () => {
    expect(isBaseMerge({ ...base, commit: { parents: [sha('a')], message: 'Fix' } })).toBe(false);
    expect(isBaseMerge({ ...base, commit: { parents: [sha('d'), sha('b')], message: 'x' } })).toBe(
      false,
    );
    expect(isBaseMerge({ ...base, commit: null })).toBe(false);
  });
});
