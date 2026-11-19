import type { NoParams } from '../reason.ts';

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
  }
}
