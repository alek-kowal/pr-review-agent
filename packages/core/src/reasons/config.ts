import type { Actor } from '../vocabulary.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** A stored setting failed validation; its default is used instead. */
    config_field_invalid: { field: string; issue: string };
    config_not_object: NoParams;
    /** Reviews wait: PR Review Agent is paused (by a Team member, with a note). */
    paused: { by: Actor | null; note: string | null };
    /** Reviews wait: the day's spend reached the daily budget. */
    budget_reached: { spentUsd: number; budgetUsd: number };
    /** A round waits: every agent slot is taken, by the runs of these PR numbers. */
    slots_busy: { slots: number; prs: number[] };
  }
}
