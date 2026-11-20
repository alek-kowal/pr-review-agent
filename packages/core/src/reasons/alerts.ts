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

    /** Why an alert's ClickUp comment was not sent (ALERTTL). `missing`: env var names. */
    alert_delivery_no_key: { missing: string[] };
    /** The app's address is not set, so the comment could not link back. */
    alert_delivery_no_app_url: NoParams;
    /** No task to comment on. `forPr`: a PR alert (no linked task and no general alerts task). */
    alert_delivery_no_task: { forPr: boolean };
    /** No connected repository has ClickUp set up. */
    alert_delivery_clickup_off: NoParams;
    /** An attempt failed. `attempt` of `attempts`; `willRetry`: the job runs again. */
    alert_delivery_failed: {
      willRetry: boolean;
      attempt: number;
      attempts: number;
      errorCode: string | null;
    };
  }
}
