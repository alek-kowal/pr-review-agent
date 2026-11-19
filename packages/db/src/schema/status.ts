import type { Reason } from '@pra/core';
import { integer, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { runs } from './runs.ts';

/**
 * The agent queue (S-10). One row per run that a start gate has seen: `admitted_at` set means the
 * run holds an agent slot (it was let through and is starting or running); `reason` set means it
 * waits (queued before its start, or running before its next agent session) and why. Pause,
 * budget and slots themselves live in `app_settings`.
 */
export const runWaits = pgTable('run_waits', {
  runId: integer('run_id')
    .primaryKey()
    .references(() => runs.id, { onDelete: 'cascade' }),
  /** When the gate let the run take a slot; null while it waits for its start. */
  admittedAt: timestamp('admitted_at', { withTimezone: true }),
  /** Why the run waits now (`paused`, `budget_reached`, `slots_busy`); null when it does not. */
  reason: jsonb().$type<Reason>(),
  /** When the current wait started. */
  waitingSince: timestamp('waiting_since', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The Claude usage limit (P-25), at most one row (`id` 1). A session that hit the subscription's
 * limit stores when runs may go on; until then the queue gates hold every run. Kept after it
 * passes (the gates compare `until` with now); the next limit overwrites it.
 */
export const usageLimitHolds = pgTable('usage_limit_holds', {
  id: integer().primaryKey().default(1),
  /** Just after the reset (or after the fallback when the reset is unknown). */
  until: timestamp('until', { withTimezone: true }).notNull(),
  /** The reset the SDK reported; null when it named none. */
  resetsAt: timestamp('resets_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
