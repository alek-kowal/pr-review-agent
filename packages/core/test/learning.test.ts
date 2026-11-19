import { describe, expect, it } from 'vitest';
import {
  HAND,
  buildCases,
  canAccept,
  capProposals,
  member,
  mergeCandidate,
  withLesson,
  type LessonCandidate,
  type PrComment,
} from '../src/index.ts';

const comment = (author: string, body = 'text'): PrComment => ({
  id: `${author}-${body}`,
  author,
  body,
  path: null,
  line: null,
});
const candidate = (overrides: Partial<LessonCandidate> = {}): LessonCandidate => ({
  id: 'c1',
  title: 'Docs links must be checked when a page is removed',
  rule: 'When a PR deletes a docs page, report every link to it.',
  prs: [270],
  status: 'proposed',
  ...overrides,
});

describe('learning', () => {
  it("leaves the PR author's own comments out of what the analyst reads (P admin.test.ts:64)", () => {
    const comments = [
      comment('kasia', 'fixed'),
      comment('tomek', 'why?'),
      comment('Kasia', 'done'),
    ];
    expect(buildCases(comments, '@kasia')).toEqual([comment('tomek', 'why?')]);
  });

  it('a duplicate adds its PR to the open candidate; a rejected one starts over (P admin.test.ts:79)', () => {
    const open = candidate();
    const merged = mergeCandidate([open], {
      id: 'c2',
      title: 'docs links must be checked when a page is removed.',
      rule: 'Same rule in other words.',
      pr: 278,
    });
    expect(merged.reason).toEqual({ code: 'candidate_merged', params: { id: 'c1', prs: 2 } });
    expect(merged.candidates).toEqual([{ ...open, prs: [270, 278] }]);

    const rejected = candidate({ status: 'rejected' });
    const again = mergeCandidate([rejected], {
      id: 'c3',
      title: rejected.title,
      rule: rejected.rule,
      pr: 281,
    });
    expect(again.reason).toEqual({
      code: 'candidate_started_over',
      params: { id: 'c3', rejectedId: 'c1' },
    });
    expect(again.candidate).toEqual({ ...rejected, id: 'c3', prs: [281], status: 'proposed' });
    expect(again.candidates).toHaveLength(2);
  });

  it('accepting needs 2 PRs and a signature, and the lesson keeps the rest of the file (P admin.test.ts:86)', () => {
    expect(canAccept(candidate({ prs: [270, 278] }), member('alek'))).toEqual({
      ok: true,
      reason: { code: 'can_accept', params: { prs: 2 } },
    });
    expect(canAccept(candidate({ prs: [270, 278] }), HAND)).toEqual({
      ok: false,
      reason: { code: 'signature_required', params: {} },
    });
    const text =
      '# Lessons\n\n## Keep public exports in changesets\n\nEvery new export needs one.\n';
    const next = withLesson(text, candidate());
    expect(next).toBe(
      '# Lessons\n\n## Keep public exports in changesets\n\nEvery new export needs one.\n\n' +
        '## Docs links must be checked when a page is removed\n\n' +
        'When a PR deletes a docs page, report every link to it.\n',
    );
    expect(withLesson(next, candidate())).toBe(next);
    expect(withLesson('', candidate())).toMatch(/^## Docs links/);
  });

  it('caps proposals at 5 per closed PR', () => {
    expect(capProposals(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual({
      kept: ['a', 'b', 'c', 'd', 'e'],
      dropped: 2,
      reason: { code: 'proposals_capped', params: { kept: 5, dropped: 2 } },
    });
    expect(capProposals(['a'])).toEqual({ kept: ['a'], dropped: 0, reason: null });
  });

  it('a lesson needs at least 2 PRs', () => {
    expect(canAccept(candidate({ prs: [270] }), member('alek'))).toEqual({
      ok: false,
      reason: { code: 'needs_more_prs', params: { have: 1, need: 2 } },
    });
    expect(canAccept(candidate({ prs: [270, 270] }), member('alek')).reason.code).toBe(
      'needs_more_prs',
    );
    expect(
      canAccept(candidate({ prs: [1, 2], status: 'rejected' }), member('alek')).reason,
    ).toEqual({
      code: 'candidate_not_open',
      params: { status: 'rejected' },
    });
  });

  it('a new lesson becomes a candidate; an accepted one is not proposed again', () => {
    const created = mergeCandidate([], { id: 'c9', title: 'New', rule: 'Rule', pr: 1 });
    expect(created.reason).toEqual({ code: 'candidate_created', params: { id: 'c9' } });
    const accepted = candidate({ status: 'accepted' });
    const repeat = mergeCandidate([accepted], {
      id: 'c10',
      title: 'x',
      rule: 'y',
      pr: 2,
      duplicateOf: 'c1',
    });
    expect(repeat.reason).toEqual({ code: 'lesson_already_accepted', params: { id: 'c1' } });
    expect(repeat.candidates).toEqual([accepted]);
  });
});
