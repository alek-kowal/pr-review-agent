import { describe, expect, it } from 'vitest';
import {
  canAcceptLesson,
  mergeCandidates,
  type LessonCandidate,
  type LessonProposal,
} from '../src/index.ts';

const open = (overrides: Partial<LessonCandidate> = {}): LessonCandidate => ({
  id: 'c1',
  title: 'Snapshot tables must be generated or tested',
  rule: 'When a README table lists files a build script copies, ask for a test or generate it.',
  prs: [244],
  status: 'proposed',
  ...overrides,
});

const proposal = (n: number, overrides: Partial<LessonProposal> = {}): LessonProposal => ({
  id: `p${n}`,
  title: `Lesson ${n}`,
  rule: `Rule ${n}`,
  pr: 278,
  ...overrides,
});

describe('mergeCandidates (S-23-T1)', () => {
  it('keeps at most 5 new candidates from 6 proposals of one PR', () => {
    const result = mergeCandidates(
      [],
      [1, 2, 3, 4, 5, 6].map((n) => proposal(n)),
    );
    expect(result.created).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(result.candidates).toHaveLength(5);
    expect(result.dropped).toBe(1);
  });

  it('a duplicate of an open candidate raises its PR count to 2 instead of adding one', () => {
    const result = mergeCandidates(
      [open()],
      [proposal(1, { title: 'Generate the snapshot table', duplicateOf: 'c1' })],
    );
    expect(result.created).toEqual([]);
    expect(result.merged).toEqual(['c1']);
    expect(result.candidates).toEqual([open({ prs: [244, 278] })]);
  });

  it('the same PR twice stays at 1', () => {
    const first = mergeCandidates([], [proposal(1)]);
    const again = mergeCandidates(first.candidates, [proposal(9, { duplicateOf: 'p1' })]);
    expect(again.candidates).toHaveLength(1);
    expect(again.candidates[0]!.prs).toEqual([278]);
    const twice = mergeCandidates([], [proposal(1), proposal(2, { title: 'Lesson 1' })]);
    expect(twice.candidates.map((c) => c.prs)).toEqual([[278]]);
  });

  it('a duplicate of an accepted lesson adds nothing', () => {
    const accepted = open({ status: 'accepted', prs: [244, 250] });
    const result = mergeCandidates([accepted], [proposal(1, { duplicateOf: 'c1' })]);
    expect(result.candidates).toEqual([accepted]);
    expect(result.created).toEqual([]);
    expect(result.merged).toEqual([]);
  });
});

describe('canAcceptLesson (S-23-T1)', () => {
  it('refuses a 1-PR candidate with the reason "1 of 2 PRs: waits for one more"', () => {
    expect(canAcceptLesson(open())).toEqual({
      ok: false,
      reason: { code: 'needs_more_prs', params: { have: 1, need: 2 } },
    });
  });

  it('allows a candidate from 2 PRs and refuses one that is no longer open', () => {
    expect(canAcceptLesson(open({ prs: [244, 278] }))).toEqual({
      ok: true,
      reason: { code: 'can_accept', params: { prs: 2 } },
    });
    expect(canAcceptLesson(open({ prs: [244, 278], status: 'rejected' })).reason.code).toBe(
      'candidate_not_open',
    );
  });
});
