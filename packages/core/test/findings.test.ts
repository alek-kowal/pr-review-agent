import { describe, expect, it } from 'vitest';
import { findingsOutcome, needsDecision, toDecide, toFix } from '../src/index.ts';
import { makeFinding, makeQuestion, makeRound } from './builders.ts';

describe('which findings need a person', () => {
  it('questions come first (P review.test.ts:36)', () => {
    const round = makeRound({
      questions: [makeQuestion(), makeQuestion({ answered: true })],
      findings: [makeFinding({ severity: 'blocking' })],
    });
    const outcome = findingsOutcome(round);
    expect(outcome.needsPerson).toBe(true);
    expect(outcome.reason).toEqual({ code: 'questions_waiting', params: { count: 1 } });
    expect(outcome.reasons.map((r) => r.code)).toEqual(['questions_waiting', 'findings_to_decide']);
  });

  it('a finding decided Implement blocks until resolved, even a nit (P review.test.ts:47)', () => {
    const nit = makeFinding({ severity: 'nit', decision: 'implement' });
    const round = makeRound({ findings: [nit] });
    expect(toFix(round.findings)).toEqual([nit]);
    expect(findingsOutcome(round).reason).toEqual({ code: 'fixes_open', params: { count: 1 } });

    const resolved = makeRound({ findings: [{ ...nit, resolved: true }] });
    expect(findingsOutcome(resolved).reason).toEqual({ code: 'round_clean', params: {} });
  });

  it('nits are optional and never block (P review.test.ts:55)', () => {
    const nit = makeFinding({ severity: 'nit' });
    expect(needsDecision(nit)).toEqual({
      needed: false,
      reason: { code: 'nit_optional', params: {} },
    });
    const outcome = findingsOutcome(
      makeRound({ findings: [nit, makeFinding({ severity: 'nit' })] }),
    );
    expect(outcome.needsPerson).toBe(false);
    expect(outcome.reason).toEqual({ code: 'round_clean', params: {} });
  });

  it('a clean round that touches sensitive files still needs a person (P review.test.ts:62)', () => {
    const round = makeRound({
      sensitive: { status: 'pending', files: ['deploy/app.yaml'], sentBackBy: null },
    });
    const outcome = findingsOutcome(round);
    expect(outcome.needsPerson).toBe(true);
    expect(outcome.reason).toEqual({ code: 'sensitive_files_need_person', params: { count: 1 } });

    const approved = makeRound({
      sensitive: { status: 'approved', files: ['deploy/app.yaml'], sentBackBy: null },
    });
    expect(findingsOutcome(approved).needsPerson).toBe(false);
  });

  it('only Blocking and Worth fixing findings that are not refuted need a decision (P review.test.ts:66)', () => {
    const blocking = makeFinding({ severity: 'blocking' });
    const worth = makeFinding({ severity: 'worth_fixing', verdict: 'not_proven' });
    const refuted = makeFinding({ severity: 'blocking', verdict: 'refuted' });
    const nit = makeFinding({ severity: 'nit' });
    expect(toDecide([blocking, refuted, worth, nit])).toEqual([blocking, worth]);
    expect(needsDecision(blocking).reason).toEqual({
      code: 'needs_decision',
      params: { severity: 'blocking' },
    });
    expect(needsDecision(refuted).reason).toEqual({ code: 'refuted', params: {} });
    expect(needsDecision({ ...blocking, decision: 'reject' }).reason).toEqual({
      code: 'decided',
      params: { decision: 'reject' },
    });
  });

  it('below level 3 every unchecked Blocking or Worth fixing finding waits for a person (P levels.test.ts:112)', () => {
    const round = makeRound({
      level: 1,
      findings: [
        makeFinding({ severity: 'blocking', verdict: 'unchecked' }),
        makeFinding({ severity: 'worth_fixing', verdict: 'unchecked' }),
      ],
    });
    const outcome = findingsOutcome(round);
    expect(outcome.reason).toEqual({ code: 'findings_to_decide', params: { count: 2 } });
    expect(needsDecision(round.findings[0]!).reason).toEqual({
      code: 'unchecked_needs_person',
      params: { severity: 'blocking' },
    });
  });

  it('at level 2 an unchecked nit stays optional while the rest wait (P levels.test.ts:170)', () => {
    const nit = makeFinding({ severity: 'nit', verdict: 'unchecked' });
    const worth = makeFinding({ severity: 'worth_fixing', verdict: 'unchecked' });
    const outcome = findingsOutcome(makeRound({ level: 2, findings: [nit, worth] }));
    expect(outcome.toDecide).toEqual([worth.id]);
    expect(needsDecision(nit).reason).toEqual({ code: 'nit_optional', params: {} });
  });
});
