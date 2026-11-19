import { describe, expect, it } from 'vitest';
import {
  BOT,
  HAND,
  chainState,
  nextAutomaticRound,
  roundLabel,
  roundStartForEvent,
  type RunRecord,
} from '../src/index.ts';
import { makePr } from './builders.ts';

let seq = 0;
const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: `run${++seq}`,
  kind: 'round',
  status: 'completed',
  trigger: 'manual',
  startedBy: HAND,
  sha: 'abc1234',
  fixSha: null,
  level: 3,
  ...overrides,
});
const ownFix = (fixSha: string, status: RunRecord['status'] = 'completed') =>
  run({ trigger: 'own_fix', startedBy: BOT, fixSha, sha: fixSha, status });

describe('round starts', () => {
  it('a PR that becomes ready for review starts round 1, signed by the bot (P sync.test.ts:22)', () => {
    const pr = makePr({ reviewedSha: null, level: 2 });
    for (const action of ['opened', 'ready_for_review']) {
      expect(roundStartForEvent({ action }, pr, null)).toEqual({
        start: true,
        roundNumber: 1,
        trigger: 'ready_for_review',
        startedBy: { kind: 'bot' },
        level: 2,
        fixSha: null,
        reason: { code: 'ready_for_review', params: { action } },
      });
    }
  });

  it('a push never starts a review, even after a review (P sync.test.ts:42)', () => {
    const start = roundStartForEvent({ action: 'synchronize' }, makePr(), null);
    expect(start).toEqual({ start: false, reason: { code: 'push_never_starts', params: {} } });
  });

  it('only the own fix at the head starts the next round, while the chain has rounds left (P sync.test.ts:90)', () => {
    const pr = makePr({ headSha: 'fix0001' });
    const chain = chainState([run(), ownFix('fix0000')]);
    expect(chain.completedRounds).toBe(2);
    expect(nextAutomaticRound(pr, chain, 'fix0001')).toMatchObject({
      start: true,
      roundNumber: 3,
      trigger: 'own_fix',
      startedBy: { kind: 'bot' },
      fixSha: 'fix0001',
      reason: { code: 'own_fix_pushed', params: { fixSha: 'fix0001', roundNumber: 3, max: 3 } },
    });
    const full = chainState([run(), ownFix('fix0000'), ownFix('fix0001')]);
    expect(nextAutomaticRound(pr, full, 'fix0001')).toEqual({
      start: false,
      reason: { code: 'rounds_used', params: { used: 3, max: 3 } },
    });
  });

  it('a new round keeps the PR level (P levels.test.ts:127)', () => {
    expect(
      roundStartForEvent({ action: 'ready_for_review' }, makePr({ level: 5 }), null),
    ).toMatchObject({
      start: true,
      level: 5,
    });
    expect(
      nextAutomaticRound(makePr({ level: 4, headSha: 'fix1' }), { completedRounds: 1 }, 'fix1'),
    ).toMatchObject({ start: true, level: 4 });
  });

  it('a draft starts nothing', () => {
    expect(roundStartForEvent({ action: 'opened' }, makePr({ draft: true }), null).reason).toEqual({
      code: 'draft',
      params: {},
    });
    expect(roundStartForEvent({ action: 'converted_to_draft' }, makePr(), null).reason.code).toBe(
      'draft',
    );
  });

  it('a fork starts nothing by itself', () => {
    expect(
      roundStartForEvent({ action: 'ready_for_review' }, makePr({ fork: true }), null),
    ).toEqual({
      start: false,
      reason: { code: 'fork', params: {} },
    });
  });

  it('an active run or a closed PR starts nothing; other events are ignored', () => {
    const active = { kind: 'round', status: 'running' } as const;
    expect(roundStartForEvent({ action: 'ready_for_review' }, makePr(), active).reason).toEqual({
      code: 'run_active',
      params: { kind: 'round', status: 'running' },
    });
    const trial = { kind: 'trial', status: 'running' } as const;
    expect(roundStartForEvent({ action: 'ready_for_review' }, makePr(), trial).start).toBe(true);
    expect(roundStartForEvent({ action: 'closed' }, makePr(), null).reason.code).toBe('pr_closed');
    expect(
      roundStartForEvent({ action: 'ready_for_review' }, makePr({ state: 'merged' }), null).reason
        .code,
    ).toBe('pr_closed');
    expect(roundStartForEvent({ action: 'labeled' }, makePr(), null).reason).toEqual({
      code: 'event_ignored',
      params: { action: 'labeled' },
    });
  });

  it('a head other than the own fix sha starts nothing', () => {
    const chain = chainState([run()]);
    expect(nextAutomaticRound(makePr({ headSha: 'theirs1' }), chain, 'fix0001')).toEqual({
      start: false,
      reason: { code: 'head_not_own_fix', params: { headSha: 'theirs1', fixSha: 'fix0001' } },
    });
    expect(nextAutomaticRound(makePr({ headSha: 'theirs1' }), chain, null).reason.code).toBe(
      'head_not_own_fix',
    );
  });
});

describe('chains', () => {
  it('failed and cancelled rounds do not count', () => {
    const chain = chainState([
      run(),
      ownFix('fix1', 'failed'),
      ownFix('fix1', 'cancelled'),
      ownFix('fix1', 'completed'),
    ]);
    expect(chain.completedRounds).toBe(2);
    expect(chain.rounds.map((r) => [r.roundNumber, r.status, r.counts])).toEqual([
      [1, 'completed', true],
      [2, 'failed', false],
      [2, 'cancelled', false],
      [2, 'completed', true],
    ]);
  });

  it('every new start begins a new chain, and a second round 1 is marked new_chain', () => {
    const first = run({ trigger: 'ready_for_review', startedBy: BOT });
    const again = run({ trigger: 'manual' });
    const chain = chainState([first, ownFix('fix1'), ownFix('fix2'), again]);
    expect(chain.completedRounds).toBe(1);
    expect(chain.chainStartRunId).toBe(again.id);
    expect(chain.rounds.map((r) => [r.roundNumber, r.newChain])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [1, true],
    ]);
  });

  it('ignores runs that are not rounds', () => {
    const chain = chainState([run(), run({ kind: 'implementer' }), run({ kind: 'trial' })]);
    expect(chain.rounds).toHaveLength(1);
  });

  it('labels a round with its number, who started it and the fix it followed', () => {
    const chain = chainState([run(), ownFix('abc123')]);
    expect(roundLabel(chain.rounds[1]!)).toEqual({
      code: 'round_label',
      params: {
        roundNumber: 2,
        max: 3,
        trigger: 'own_fix',
        startedBy: { kind: 'bot' },
        fixSha: 'abc123',
        newChain: false,
      },
    });
  });
});
