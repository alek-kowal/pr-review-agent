import type { Decision, Severity } from '../vocabulary.ts';
import type { NoParams } from '../reason.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** A Blocking or Worth fixing finding, not refuted, waits for a decision. */
    needs_decision: { severity: Severity };
    /** Nothing verified it (below level 3, or Verify skipped), so a person decides. */
    unchecked_needs_person: { severity: Severity };
    nit_optional: NoParams;
    refuted: NoParams;
    decided: { decision: Decision };
    fix_resolved: NoParams;
    /** Decided Implement and not resolved yet. Blocks, even for a nit. */
    implement_open: { severity: Severity };
    questions_waiting: { count: number };
    findings_to_decide: { count: number };
    sensitive_files_need_person: { count: number };
    fixes_open: { count: number };
    round_clean: NoParams;
  }
}
