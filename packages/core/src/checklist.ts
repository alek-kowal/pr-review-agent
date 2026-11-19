import './reasons/checklist.ts';
import { openQuestions, toDecide, toFix } from './findings.ts';
import type { CheckConclusion, PrSnapshot } from './model.ts';
import { prState } from './pr-state.ts';
import { reason, type Reason } from './reason.ts';

export const CHECKLIST_ITEMS = [
  'review_covers_head',
  'questions_answered',
  'nothing_undecided',
  'nothing_waiting_for_fix',
  'sensitive_files_approved',
  'ci_green',
  'no_changes_requested',
] as const;
export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number];

export interface ChecklistItem {
  item: ChecklistItemKey;
  ok: boolean;
  reason: Reason;
}

export interface Checklist {
  /** Every item passes and the PR is Ready to merge. */
  ok: boolean;
  /** In `CHECKLIST_ITEMS` order; `sensitive_files_approved` only when the PR has sensitive files. */
  items: ChecklistItem[];
}

const PASSING: ReadonlySet<CheckConclusion> = new Set(['success', 'skipped', 'neutral']);

const item = (key: ChecklistItemKey, ok: boolean, why: Reason): ChecklistItem => ({
  item: key,
  ok,
  reason: why,
});

function reviewCoversHead(pr: PrSnapshot): ChecklistItem {
  const key = 'review_covers_head';
  const roundRunning = pr.activeRun?.kind === 'round' && pr.activeRun.status === 'running';
  const sha = pr.reviewedSha;
  if (!sha) {
    return item(
      key,
      false,
      roundRunning
        ? reason('checklist_round_running', { headSha: pr.headSha })
        : reason('checklist_no_review'),
    );
  }
  if (pr.commitsSinceReview > 0) {
    return item(
      key,
      false,
      reason('checklist_commits_after_review', { count: pr.commitsSinceReview, reviewedSha: sha }),
    );
  }
  if (roundRunning)
    return item(key, false, reason('checklist_round_running', { headSha: pr.headSha }));
  if (pr.failedRound) {
    return item(
      key,
      false,
      reason('checklist_last_round_failed', { roundNumber: pr.failedRound.roundNumber }),
    );
  }
  if (sha !== pr.headSha) {
    return item(
      key,
      false,
      reason('checklist_fix_after_review', { fixSha: pr.headSha, reviewedSha: sha }),
    );
  }
  return item(key, true, reason('checklist_review_on_head', { sha }));
}

function questionsAnswered(pr: PrSnapshot): ChecklistItem {
  const total = pr.questions.length;
  const open = openQuestions(pr.questions).length;
  const why =
    total === 0
      ? reason('checklist_no_questions')
      : open === 0
        ? reason('checklist_questions_answered', { count: total })
        : reason('checklist_questions_open', { answered: total - open, total });
  return item('questions_answered', open === 0, why);
}

function nothingUndecided(pr: PrSnapshot): ChecklistItem {
  const count = toDecide(pr.findings).length;
  const why = count
    ? reason('checklist_findings_undecided', { count })
    : pr.findings.length
      ? reason('checklist_findings_decided')
      : reason('checklist_no_findings');
  return item('nothing_undecided', count === 0, why);
}

function nothingWaitingForFix(pr: PrSnapshot): ChecklistItem {
  const count = toFix(pr.findings).length;
  const why = count
    ? reason('checklist_fixes_pending', { count })
    : reason('checklist_no_fix_pending');
  return item('nothing_waiting_for_fix', count === 0, why);
}

function sensitiveApproved(pr: PrSnapshot): ChecklistItem | null {
  const sensitive = pr.sensitive;
  if (!sensitive) return null;
  const count = sensitive.files.length;
  const why =
    sensitive.status === 'approved'
      ? reason('checklist_sensitive_approved', { count })
      : sensitive.status === 'sent_back'
        ? reason('checklist_sensitive_sent_back', { count, by: sensitive.sentBackBy })
        : reason('checklist_sensitive_pending', { count });
  return item('sensitive_files_approved', sensitive.status === 'approved', why);
}

/** At least one check, and every check success, skipped or neutral. A failure beats a running check. */
function ciGreen(pr: PrSnapshot): ChecklistItem {
  const key = 'ci_green';
  const total = pr.ci.length;
  if (total === 0) return item(key, false, reason('checklist_ci_none'));
  const failed = pr.ci.filter((c) => c.conclusion !== null && !PASSING.has(c.conclusion));
  if (failed.length) {
    const names = failed.map((c) => c.name);
    return item(
      key,
      false,
      reason('checklist_ci_failing', { failed: failed.length, total, names }),
    );
  }
  const running = pr.ci.filter((c) => c.conclusion === null).length;
  if (running) return item(key, false, reason('checklist_ci_running', { running, total }));
  return item(key, true, reason('checklist_ci_green', { passed: total, sha: pr.headSha }));
}

function noChangesRequested(pr: PrSnapshot): ChecklistItem {
  const by = pr.changesRequestedBy;
  return by.length
    ? item('no_changes_requested', false, reason('checklist_changes_requested', { by: [...by] }))
    : item('no_changes_requested', true, reason('checklist_no_changes_requested'));
}

/**
 * The merge checklist. Each item says whether it passes and why. The checklist is green only when
 * every item passes and the PR state is Ready to merge, so a queued run or a waiting patch also
 * keeps it red.
 */
export function checklist(pr: PrSnapshot): Checklist {
  const items = [
    reviewCoversHead(pr),
    questionsAnswered(pr),
    nothingUndecided(pr),
    nothingWaitingForFix(pr),
    sensitiveApproved(pr),
    ciGreen(pr),
    noChangesRequested(pr),
  ].filter((i): i is ChecklistItem => i !== null);
  return { ok: items.every((i) => i.ok) && prState(pr) === 'ready_to_merge', items };
}
