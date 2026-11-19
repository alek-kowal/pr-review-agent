import type { Actor, RunKind } from '../vocabulary.ts';
import type { RoundTrigger, RunStatus } from '../model.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** Round 1 starts: the PR became ready for review. */
    ready_for_review: { action: string };
    /** The next round of the chain starts: the head is the fix PR Review Agent pushed. */
    own_fix_pushed: { fixSha: string; roundNumber: number; max: number };
    draft: NoParams;
    fork: NoParams;
    push_never_starts: NoParams;
    run_active: { kind: RunKind; status: RunStatus };
    pr_closed: NoParams;
    pr_not_found: { pullRequestId: number };
    event_ignored: { action: string };
    head_not_own_fix: { headSha: string; fixSha: string | null };
    rounds_used: { used: number; max: number };
    /** "Round n of 3 · started by ..." */
    round_label: {
      roundNumber: number;
      max: number;
      trigger: RoundTrigger;
      startedBy: Actor;
      fixSha: string | null;
      newChain: boolean;
    };
  }
}
