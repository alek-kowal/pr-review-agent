import type { ChangeType } from '../vocabulary.ts';
import type { NoParams } from '../reason.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    path_one_way: { path: string };
    sensitive_one_way: { path: string; pattern: string };
    size_over_threshold: { lines: number; threshold: number };
    paths_uses_existing: { files: number };
    paths_change_behaviour: { path: string };
    rules_floor: { changeType: ChangeType };
    judge_raised: { from: ChangeType; to: ChangeType };
    judge_agreed: { changeType: ChangeType };
    judge_cannot_lower: { judged: ChangeType; kept: ChangeType };
    forced_by_person: { forced: ChangeType; rules: ChangeType };
    one_way_needs_person: NoParams;
    change_type_no_person: { changeType: ChangeType };
  }
}
