import type { NoParams } from '../reason.ts';
import type { StageKey } from '../vocabulary.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** Title: a stage timed out or crashed. */
    alert_failed: {
      prNumber: number;
      stage: StageKey;
      errorCode: string;
      timeoutMinutes: number | null;
    };
    /** Title: a chain used 3 of 3 rounds with a fix still open. */
    alert_rounds: { prNumber: number; max: number };
    /** Title: one PR's real spend passed the threshold. */
    alert_cost: { prNumber: number; spentUsd: number; maxUsd: number };
    /** Title: today's spend passed `percent` of the budget (100 means reached). */
    alert_budget: { percent: number; spentUsd: number; budgetUsd: number };

    alert_next_retry: { stage: StageKey };
    alert_next_start_review: NoParams;
    alert_next_split: NoParams;
    alert_next_budget: NoParams;

    /** Why the bot cleared an alert (its end note). */
    alert_end_retried: NoParams;
    alert_end_new_review: NoParams;
    alert_end_below_threshold: NoParams;
    alert_end_midnight: NoParams;
    alert_end_pr_closed: NoParams;
  }
}
