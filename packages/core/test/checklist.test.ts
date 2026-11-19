import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_ITEMS,
  HAND,
  checklist,
  member,
  type ActiveRun,
  type ChecklistItemKey,
  type PrSnapshot,
} from '../src/index.ts';
import { makeFinding, makePr, makeQuestion } from './builders.ts';

const runningRound = (overrides: Partial<ActiveRun> = {}): ActiveRun => ({
  kind: 'round',
  status: 'running',
  roundKind: 'full',
  trigger: 'manual',
  startedBy: HAND,
  roundNumber: 1,
  fixSha: null,
  retryFrom: null,
  queue: null,
  ...overrides,
});

const itemOf = (pr: PrSnapshot, key: ChecklistItemKey) => {
  const found = checklist(pr).items.find((i) => i.item === key);
  if (!found) throw new Error(`no ${key} item`);
  return found;
};

/** The item fails with the code, and only that item fails. */
const failsOnly = (pr: PrSnapshot, key: ChecklistItemKey, code: string) => {
  const result = checklist(pr);
  expect(result.ok).toBe(false);
  expect(result.items.filter((i) => !i.ok).map((i) => [i.item, i.reason.code])).toEqual([
    [key, code],
  ]);
};

describe('merge checklist', () => {
  it('is green only when every item passes at the reviewed head and the PR is Ready to merge (P review.test.ts:130)', () => {
    const ready = makePr({
      findings: [
        makeFinding({ decision: 'reject' }),
        makeFinding({ decision: 'implement', resolved: true }),
        makeFinding({ severity: 'nit' }),
      ],
      questions: [makeQuestion({ answered: true })],
    });
    const green = checklist(ready);
    expect(green.ok).toBe(true);
    expect(green.items.map((i) => i.item)).toEqual(
      CHECKLIST_ITEMS.filter((k) => k !== 'sensitive_files_approved'),
    );
    expect(green.items.every((i) => i.ok)).toBe(true);
    expect(itemOf(ready, 'review_covers_head').reason).toEqual({
      code: 'checklist_review_on_head',
      params: { sha: 'abc1234' },
    });

    // An open question keeps it red, and so does a state that is not Ready to merge.
    expect(checklist({ ...ready, questions: [makeQuestion()] }).ok).toBe(false);
    const patchWaiting = checklist({
      ...ready,
      patch: { status: 'ready', fixed: 1, total: 1, reproductionsPass: true, waiting: null },
    });
    expect(patchWaiting.items.every((i) => i.ok)).toBe(true);
    expect(patchWaiting.ok).toBe(false);
  });

  it('shows the sensitive files item only when the PR has sensitive files', () => {
    expect(checklist(makePr()).items.map((i) => i.item)).not.toContain('sensitive_files_approved');
    const approved = makePr({
      sensitive: { status: 'approved', files: ['.github/workflows/ci.yml'], sentBackBy: null },
    });
    expect(itemOf(approved, 'sensitive_files_approved')).toEqual({
      item: 'sensitive_files_approved',
      ok: true,
      reason: { code: 'checklist_sensitive_approved', params: { count: 1 } },
    });
    expect(checklist(approved).ok).toBe(true);
  });

  describe('the review covers the head commit', () => {
    it('fails with no review yet', () => {
      failsOnly(makePr({ reviewedSha: null }), 'review_covers_head', 'checklist_no_review');
    });

    it('fails while a round is running, reviewed or not', () => {
      failsOnly(
        makePr({ reviewedSha: null, activeRun: runningRound() }),
        'review_covers_head',
        'checklist_round_running',
      );
      failsOnly(
        makePr({ activeRun: runningRound() }),
        'review_covers_head',
        'checklist_round_running',
      );
      // A queued round is not running yet; the queued state keeps the checklist red.
      const queued = makePr({
        activeRun: runningRound({ status: 'queued', queue: { cause: 'slot' } }),
      });
      expect(itemOf(queued, 'review_covers_head').ok).toBe(true);
      expect(checklist(queued).ok).toBe(false);
    });

    it('fails with commits after the review, before a running round', () => {
      const pr = makePr({
        headSha: 'def5678',
        commitsSinceReview: 2,
        activeRun: runningRound(),
      });
      failsOnly(pr, 'review_covers_head', 'checklist_commits_after_review');
      expect(itemOf(pr, 'review_covers_head').reason.params).toEqual({
        count: 2,
        reviewedSha: 'abc1234',
      });
    });

    it('fails when the last round failed', () => {
      const pr = makePr({
        failedRound: { stage: 'review', errorCode: 'timeout', roundNumber: 2, timeoutMinutes: 30 },
      });
      failsOnly(pr, 'review_covers_head', 'checklist_last_round_failed');
      expect(itemOf(pr, 'review_covers_head').reason.params).toEqual({ roundNumber: 2 });
    });

    it('fails when a fix was pushed after the review', () => {
      const pr = makePr({ headSha: 'fix9999' });
      failsOnly(pr, 'review_covers_head', 'checklist_fix_after_review');
      expect(itemOf(pr, 'review_covers_head').reason.params).toEqual({
        fixSha: 'fix9999',
        reviewedSha: 'abc1234',
      });
    });

    it('ignores trial and analyst runs', () => {
      const trial = makePr({ activeRun: runningRound({ kind: 'trial', roundKind: null }) });
      expect(itemOf(trial, 'review_covers_head').ok).toBe(true);
      expect(checklist(trial).ok).toBe(true);
    });
  });

  it('fails while a question is open', () => {
    const pr = makePr({ questions: [makeQuestion({ answered: true }), makeQuestion()] });
    failsOnly(pr, 'questions_answered', 'checklist_questions_open');
    expect(itemOf(pr, 'questions_answered').reason.params).toEqual({ answered: 1, total: 2 });
    expect(itemOf(makePr(), 'questions_answered').reason.code).toBe('checklist_no_questions');
  });

  it('fails while a finding is undecided', () => {
    const pr = makePr({ findings: [makeFinding(), makeFinding({ verdict: 'refuted' })] });
    failsOnly(pr, 'nothing_undecided', 'checklist_findings_undecided');
    expect(itemOf(pr, 'nothing_undecided').reason.params).toEqual({ count: 1 });
    expect(itemOf(makePr(), 'nothing_undecided').reason.code).toBe('checklist_no_findings');
  });

  it('fails while a finding decided Implement is not resolved', () => {
    const pr = makePr({
      findings: [
        makeFinding({ decision: 'implement' }),
        makeFinding({ decision: 'implement', resolved: false }),
      ],
    });
    failsOnly(pr, 'nothing_waiting_for_fix', 'checklist_fixes_pending');
    expect(itemOf(pr, 'nothing_waiting_for_fix').reason.params).toEqual({ count: 2 });
  });

  it('fails while sensitive files wait or were sent back', () => {
    const files = ['db/migrations/0004.sql', '.github/workflows/ci.yml'];
    failsOnly(
      makePr({ sensitive: { status: 'pending', files, sentBackBy: null } }),
      'sensitive_files_approved',
      'checklist_sensitive_pending',
    );
    const sentBack = makePr({
      sensitive: { status: 'sent_back', files, sentBackBy: member('tomek') },
    });
    failsOnly(sentBack, 'sensitive_files_approved', 'checklist_sensitive_sent_back');
    expect(itemOf(sentBack, 'sensitive_files_approved').reason.params).toEqual({
      count: 2,
      by: member('tomek'),
    });
  });

  describe('CI green in GitHub', () => {
    it('fails with no checks at all', () => {
      failsOnly(makePr({ ci: [] }), 'ci_green', 'checklist_ci_none');
    });

    it('passes on success, skipped and neutral', () => {
      const pr = makePr({
        ci: [
          { name: 'build', conclusion: 'success' },
          { name: 'e2e', conclusion: 'skipped' },
          { name: 'lint', conclusion: 'neutral' },
        ],
      });
      expect(itemOf(pr, 'ci_green').reason).toEqual({
        code: 'checklist_ci_green',
        params: { passed: 3, sha: 'abc1234' },
      });
    });

    it('fails on any other conclusion, and a failure beats a running check', () => {
      for (const conclusion of [
        'failure',
        'cancelled',
        'timed_out',
        'action_required',
        'stale',
      ] as const) {
        failsOnly(
          makePr({ ci: [{ name: 'build', conclusion }] }),
          'ci_green',
          'checklist_ci_failing',
        );
      }
      const mixed = makePr({
        ci: [
          { name: 'build', conclusion: 'success' },
          { name: 'e2e', conclusion: null },
          { name: 'test', conclusion: 'failure' },
        ],
      });
      expect(itemOf(mixed, 'ci_green').reason).toEqual({
        code: 'checklist_ci_failing',
        params: { failed: 1, total: 3, names: ['test'] },
      });
    });

    it('fails while a check is still running', () => {
      const pr = makePr({
        ci: [
          { name: 'build', conclusion: 'success' },
          { name: 'e2e', conclusion: null },
        ],
      });
      failsOnly(pr, 'ci_green', 'checklist_ci_running');
      expect(itemOf(pr, 'ci_green').reason.params).toEqual({ running: 1, total: 2 });
    });
  });

  it('fails while someone requested changes in GitHub', () => {
    const pr = makePr({ changesRequestedBy: ['tomek'] });
    failsOnly(pr, 'no_changes_requested', 'checklist_changes_requested');
    expect(itemOf(pr, 'no_changes_requested').reason.params).toEqual({ by: ['tomek'] });
  });
});
