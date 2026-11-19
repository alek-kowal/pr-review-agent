import { describe, expect, it } from 'vitest';
import { BOT, HAND, chainState, roundLabel, type RunRecord } from '../src/index.ts';

let seq = 0;
const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: `run${++seq}`,
  kind: 'round',
  status: 'completed',
  trigger: 'ready_for_review',
  startedBy: BOT,
  sha: 'abc1234',
  fixSha: null,
  level: 3,
  ...overrides,
});

const label = (roundNumber: number, extra: Record<string, unknown>) => ({
  code: 'round_label',
  params: { roundNumber, max: 3, fixSha: null, newChain: false, ...extra },
});

describe('roundLabel(run, chain)', () => {
  it('labels the round started by the ready event, a fix check and a start by hand', () => {
    const ready = run();
    const fix = run({ trigger: 'own_fix', fixSha: 'abc123', sha: 'abc123' });
    const byHand = run({ trigger: 'manual', startedBy: HAND });
    const chain = chainState([ready, fix, byHand]);

    expect(roundLabel(ready, chain)).toEqual(
      label(1, { trigger: 'ready_for_review', startedBy: { kind: 'bot' } }),
    );
    // "Round 2 of 3 · started by pr-review-agent after fix abc123"
    expect(roundLabel(fix, chain)).toEqual(
      label(2, { trigger: 'own_fix', startedBy: { kind: 'bot' }, fixSha: 'abc123' }),
    );
    // "Round 1 of 3 · started by hand", marked "new chain"
    expect(roundLabel(byHand, chain)).toEqual(
      label(1, { trigger: 'manual', startedBy: { kind: 'hand' }, newChain: true }),
    );
  });

  it('a failed round does not use up a number: the next fix check keeps it', () => {
    const first = run();
    const failed = run({ trigger: 'own_fix', fixSha: 'f1', status: 'failed' });
    const retry = run({ trigger: 'own_fix', fixSha: 'f1' });
    const chain = chainState([first, failed, retry]);
    expect(roundLabel(failed, chain)?.params).toMatchObject({ roundNumber: 2 });
    expect(roundLabel(retry, chain)?.params).toMatchObject({ roundNumber: 2 });
  });

  it('is null for a run that is not a round of the chain', () => {
    const trial = run({ kind: 'trial' });
    const chain = chainState([run(), trial]);
    expect(roundLabel(trial, chain)).toBeNull();
    expect(roundLabel({ id: 'elsewhere' }, chain)).toBeNull();
  });
});
