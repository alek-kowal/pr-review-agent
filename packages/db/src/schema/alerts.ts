import {
  ALERT_KINDS,
  ALERT_STATUSES,
  BUDGET_ALERT_PERCENTS,
  DEFAULT_ALERT_COST_USD,
  DEFAULT_BUDGET_ALERT_PERCENT,
  type AlertDeliveryReason,
  type AlertEndNote,
  type AlertNextStep,
  type AlertTitle,
  type BudgetAlertPercent,
} from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { runs } from './runs.ts';

/**
 * How an alert's ClickUp comment went: `pending` until the delivery job runs, `sent` with the
 * comment id, `not_configured` without a ClickUp key or a target task (nothing is faked), `failed`
 * after an attempt failed (`deliveryReason` says whether the job tries again).
 */
export const ALERT_DELIVERY_STATUSES = ['pending', 'sent', 'not_configured', 'failed'] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];

/** Who ended an alert: the bot when its problem was gone, or a person who dismissed it. */
export const ALERT_ENDERS = ['bot', 'hand'] as const;
export type AlertEnder = (typeof ALERT_ENDERS)[number];

/** S-18: one row per alert ever raised. A key is unique, so it fires once. */
export const alerts = pgTable(
  'alerts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    kind: text({ enum: ALERT_KINDS }).notNull(),
    /** Core `alertKey`, for example `cost:12` or `budget:2026-11-19:80`. */
    key: text().notNull().unique(),
    /** Null for the daily budget. */
    pullRequestId: integer('pull_request_id').references(() => pullRequests.id, {
      onDelete: 'cascade',
    }),
    /** The failed run of a run-failed alert (its Retry); null for the other kinds. */
    runId: integer('run_id').references(() => runs.id, { onDelete: 'set null' }),
    /** Reason code: the problem. */
    title: jsonb().$type<AlertTitle>().notNull(),
    /** Reason code: the next step. */
    nextStep: jsonb('next_step').$type<AlertNextStep>().notNull(),
    /** The ClickUp task the comment goes (or went) to; null when there is none. */
    clickupTaskId: text('clickup_task_id'),
    /** True when it goes to the general alerts task (budget, or a PR without a task). */
    toGeneralTask: boolean('to_general_task').notNull().default(false),
    commentId: text('comment_id'),
    deliveryStatus: text('delivery_status', { enum: ALERT_DELIVERY_STATUSES })
      .notNull()
      .default('pending'),
    /** Reason code: why it was not sent, or how the last failed attempt went; null otherwise. */
    deliveryReason: jsonb('delivery_reason').$type<AlertDeliveryReason>(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    status: text({ enum: ALERT_STATUSES }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: text('ended_by', { enum: ALERT_ENDERS }),
    /** Reason code: why the bot cleared it; null when dismissed. */
    endNote: jsonb('end_note').$type<AlertEndNote>(),
  },
  (t) => [
    index('alerts_status').on(t.status, t.createdAt),
    index('alerts_pull_request').on(t.pullRequestId, t.status),
  ],
);

/** One row (id 1): which alerts are on, their thresholds and the general alerts task. */
export const alertConfig = pgTable(
  'alert_config',
  {
    id: integer().primaryKey().default(1),
    failedOn: boolean('failed_on').notNull().default(true),
    roundsOn: boolean('rounds_on').notNull().default(true),
    costOn: boolean('cost_on').notNull().default(true),
    costMaxUsd: numeric('cost_max_usd', { precision: 12, scale: 2, mode: 'number' })
      .notNull()
      .default(DEFAULT_ALERT_COST_USD),
    budgetOn: boolean('budget_on').notNull().default(true),
    budgetPercent: integer('budget_percent')
      .$type<BudgetAlertPercent>()
      .notNull()
      .default(DEFAULT_BUDGET_ALERT_PERCENT),
    generalTaskId: text('general_task_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('alert_config_single_row', sql`${t.id} = 1`),
    check('alert_config_cost_positive', sql`${t.costMaxUsd} > 0`),
    check(
      'alert_config_budget_percent',
      sql`${t.budgetPercent} in (${sql.raw(BUDGET_ALERT_PERCENTS.join(', '))})`,
    ),
  ],
);
