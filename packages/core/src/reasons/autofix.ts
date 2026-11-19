declare module '../reason.ts' {
  interface ReasonParams {
    autofix_conditions_met: { count: number };
    nothing_to_fix: NoParams;
    fork_read_only: NoParams;
    autofix_trial: NoParams;
    open_questions: { count: number };
    unsure_verdicts: { count: number };
    fix_needs_decision: { count: number };
    one_way_door_hold: NoParams;
    autofix_paused: NoParams;
    autofix_budget_reached: NoParams;
    head_moved_since_review: { commits: number };
    auto_patches_used: { used: number; max: number };
    push_conditions_met: NoParams;
    head_moved_since_patch: NoParams;
    not_all_fixed: { fixed: number; total: number };
    reproductions_fail: { failed: number; total: number };
    patch_touches_sensitive: { path: string; pattern: string };
    /** A finding autofix was about to decide changed meanwhile (someone decided it). */
    autofix_findings_changed: NoParams;
    /** The PR's level is now below 5: someone lowered it after the autofix run started. */
    autofix_level_lowered: { level: number };
    /** A person edited or reverted a file of the bot's patch: they push it, signed. */
    autofix_patch_edited: NoParams;
  }
}
