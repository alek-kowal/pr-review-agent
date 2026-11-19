import type { NoParams } from '../reason.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** A stored setting failed validation; its default is used instead. */
    config_field_invalid: { field: string; issue: string };
    config_not_object: NoParams;
    /** Reviews wait: PR Review Agent is paused. */
    paused: { note: string | null };
    /** Reviews wait: the day's spend reached the daily budget. */
    budget_reached: { spentUsd: number; budgetUsd: number };
  }
}
