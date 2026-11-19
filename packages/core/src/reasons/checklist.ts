import type { Actor } from '../vocabulary.ts';

// Merge checklist items. Every code has a `checklist_` prefix, because codes share one namespace.
declare module '../reason.ts' {
  interface ReasonParams {
    // The review covers the head commit.
    checklist_review_on_head: { sha: string };
    checklist_no_review: NoParams;
    checklist_round_running: { headSha: string };
    checklist_commits_after_review: { count: number; reviewedSha: string };
    checklist_last_round_failed: { roundNumber: number };
    /** PR Review Agent pushed a fix after the review, and no fix check has covered it yet. */
    checklist_fix_after_review: { fixSha: string; reviewedSha: string };
    // Questions answered.
    checklist_no_questions: NoParams;
    checklist_questions_answered: { count: number };
    checklist_questions_open: { answered: number; total: number };
    // No finding left undecided.
    checklist_no_findings: NoParams;
    checklist_findings_decided: NoParams;
    checklist_findings_undecided: { count: number };
    // Nothing waiting for a fix.
    checklist_no_fix_pending: NoParams;
    checklist_fixes_pending: { count: number };
    // Sensitive files approved (only when the PR has some).
    checklist_sensitive_approved: { count: number };
    checklist_sensitive_pending: { count: number };
    checklist_sensitive_sent_back: { count: number; by: Actor | null };
    // CI green in GitHub.
    checklist_ci_green: { passed: number; sha: string };
    checklist_ci_none: NoParams;
    checklist_ci_failing: { failed: number; total: number; names: string[] };
    checklist_ci_running: { running: number; total: number };
    // No "changes requested" in GitHub.
    checklist_no_changes_requested: NoParams;
    checklist_changes_requested: { by: string[] };
  }
}
