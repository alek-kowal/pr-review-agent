import type { Reason } from '../reason.ts';
import type { Actor, LevelNumber } from '../vocabulary.ts';

// Next step banners (`state_*`) and who usually acts (`who_*`), one per PR state variant.
declare module '../reason.ts' {
  interface ReasonParams {
    state_draft: NoParams;
    state_never_reviewed: { fork: boolean };
    state_queued_paused: { by: Actor | null; note: string };
    state_queued_budget: { spentUsd: number; budgetUsd: number };
    state_queued_slot: NoParams;
    /** "Paused until <time>: Claude usage limit" (P-25). */
    state_queued_usage_limit: { until: string };
    state_round_starting: { roundNumber: number; max: number };
    state_round_running_by_hand: { roundNumber: number; max: number };
    state_round_retrying: { stage: string; roundNumber: number; max: number };
    state_fix_check_running: { fixSha: string | null; roundNumber: number; max: number };
    state_fixing: { count: number; startedBy: Actor };
    state_stage_failed: {
      stage: string;
      errorCode: string;
      timeoutMinutes: number | null;
      roundNumber: number;
    };
    state_new_commits: { count: number; reviewedSha: string };
    state_patch_ready: { fixed: number; total: number; reproductionsPass: boolean };
    /** Level 5 autofix stopped before the push; `reason` is the autofix hold. */
    state_autofix_waiting: { reason: Reason };
    state_questions_waiting: { count: number; toDecideAfter: number };
    state_findings_to_decide: { count: number; reviewers: number };
    state_sensitive_files: { count: number };
    state_sensitive_sent_back: { count: number; by: Actor | null };
    state_waiting_for_fix: { count: number };
    state_rounds_used: { used: number; max: number; open: number };
    state_ready_to_merge: { sha: string };
    state_merged: { by: Actor | null };
    state_closed: { by: Actor | null };
    who_author_marks_ready: { author: string };
    who_anyone_can_start: NoParams;
    who_anyone_can_resume: NoParams;
    who_starts_by_itself: NoParams;
    who_no_one_needs_to_act: NoParams;
    who_usually_author: { author: string };
    who_usually_teammate: { author: string };
    who_anyone_can_retry: NoParams;
    who_nobody: NoParams;
    implement_below_level: { level: LevelNumber; need: LevelNumber };
  }
}
