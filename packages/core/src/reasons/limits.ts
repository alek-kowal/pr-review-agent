import type { VerifyScope } from '../limits.ts';
import type { ChangeType, Severity } from '../vocabulary.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    severity_not_allowed: { severity: Severity; dropped: number };
    over_max_findings: { max: number; dropped: number };
    max_findings_clamped: { requested: number; max: number };
    questions_not_allowed: { dropped: number };
    over_max_questions: { max: number; dropped: number };
    verify_off_for_change_type: {
      changeType: ChangeType | null;
      scope: Exclude<VerifyScope, 'all'>;
    };
    verify_on: { changeType: ChangeType | null };
  }
}
