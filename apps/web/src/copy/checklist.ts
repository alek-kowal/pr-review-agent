// Copy for the merge checklist: each item's name and every `checklist_*` reason code.
import type { ChecklistItemKey } from '@pra/core';

type Params = Record<string, unknown>;
const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const sha = (value: unknown) => String(value ?? '').slice(0, 7);
const list = (value: unknown) => (Array.isArray(value) ? value.map(String).join(', ') : '');

export const checklist = {
  title: 'Merge checklist',
  passes: 'Passes',
  fails: 'Fails',
  progress: (ok: number, total: number) => `${ok} of ${total}`,
  showAll: (total: number) => `Show all ${total}`,
  showFailing: 'Show failing only',
  items: {
    review_covers_head: 'Review covers the head commit',
    questions_answered: 'Questions answered',
    nothing_undecided: 'No finding left undecided',
    nothing_waiting_for_fix: 'Nothing waiting for a fix',
    sensitive_files_approved: 'Sensitive files approved',
    ci_green: 'CI green in GitHub',
    no_changes_requested: 'No "changes requested" in GitHub',
  } satisfies Record<ChecklistItemKey, string>,
  reasons: {
    checklist_review_on_head: (p) => `The review covers ${sha(p.sha)}, the head commit.`,
    checklist_no_review: () => 'Not reviewed yet.',
    checklist_round_running: (p) => `A round is reviewing ${sha(p.headSha)} now.`,
    checklist_commits_after_review: (p) =>
      `${plural(n(p.count), 'commit')} after the review of ${sha(p.reviewedSha)}.`,
    checklist_last_round_failed: (p) => `Round ${n(p.roundNumber)} failed.`,
    checklist_fix_after_review: (p) =>
      `Fix ${sha(p.fixSha)} came after the review of ${sha(p.reviewedSha)}; no fix check covers it yet.`,
    checklist_no_questions: () => 'No questions.',
    checklist_questions_answered: (p) => `${plural(n(p.count), 'question')} answered.`,
    checklist_questions_open: (p) => `${n(p.answered)} of ${n(p.total)} questions answered.`,
    checklist_no_findings: () => 'No findings.',
    checklist_findings_decided: () => 'Every finding is decided.',
    checklist_findings_undecided: (p) => `${plural(n(p.count), 'finding')} to decide.`,
    checklist_no_fix_pending: () => 'No fix pending.',
    checklist_fixes_pending: (p) => `${plural(n(p.count), 'finding')} to implement.`,
    checklist_sensitive_approved: (p) => `${plural(n(p.count), 'sensitive file')} approved.`,
    checklist_sensitive_pending: (p) =>
      `${plural(n(p.count), 'sensitive file')} need a person's OK.`,
    checklist_sensitive_sent_back: (p) => `${plural(n(p.count), 'sensitive file')} sent back.`,
    checklist_ci_green: (p) => `${plural(n(p.passed), 'check')} passed on ${sha(p.sha)}.`,
    checklist_ci_none: () => 'No CI checks reported yet.',
    checklist_ci_failing: (p) =>
      `${n(p.failed)} of ${plural(n(p.total), 'check')} failing: ${list(p.names)}.`,
    checklist_ci_running: (p) => `${n(p.running)} of ${plural(n(p.total), 'check')} still running.`,
    checklist_no_changes_requested: () => 'Nobody requested changes.',
    checklist_changes_requested: (p) => `Changes requested by ${list(p.by)}.`,
  } as Record<string, (params: Params) => string>,
};
