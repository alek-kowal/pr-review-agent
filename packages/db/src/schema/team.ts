import { DECISIONS } from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { findings } from './runs.ts';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * The people who sign. Nobody logs in: a signature is a member picked from this list. Removal is
 * soft, so past signatures keep their name.
 */
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    githubLogin: text('github_login').notNull(),
    /** Who "Notify author" mentions in ClickUp; null until someone sets it. */
    clickupUserId: text('clickup_user_id'),
    createdAt: createdAt(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    // GitHub logins are case-insensitive; a removed member frees their login.
    uniqueIndex('team_members_github_login_active')
      .on(sql`lower(${t.githubLogin})`)
      .where(sql`${t.removedAt} is null`),
  ],
);

/** One signed decision on one or many findings of a PR. Undo marks it, never deletes it. */
export const decisionBatches = pgTable(
  'decision_batches',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    decision: text({ enum: DECISIONS }).notNull(),
    /** Why, for Reject (required there by the api) and optionally for the others. */
    reason: text(),
    signedBy: uuid('signed_by')
      .notNull()
      .references(() => teamMembers.id),
    createdAt: createdAt(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (t) => [
    index('decision_batches_pull_request').on(t.pullRequestId, t.createdAt),
    check(
      'decision_batches_decision',
      sql.raw(`decision in (${DECISIONS.map((d) => `'${d}'`).join(', ')})`),
    ),
  ],
);

/** Where a Defer to ClickUp finding's follow-up task stands (S-06-T5); null before the job. */
export const FOLLOW_UP_STATUSES = ['creating', 'created', 'failed'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

/**
 * The findings a batch decided. A finding's current decision is its latest batch that is not
 * undone. `version` is the finding's version right after this batch, so undo can tell whether the
 * finding changed since.
 */
export const findingDecisions = pgTable(
  'finding_decisions',
  {
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id')
      .notNull()
      .references(() => decisionBatches.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    /** Defer to ClickUp only: the follow-up task (S-06-T5). */
    followUpStatus: text('follow_up_status', { enum: FOLLOW_UP_STATUSES }),
    followUpTaskId: text('follow_up_task_id'),
    followUpUrl: text('follow_up_url'),
    /** Why there is no follow-up task: a reason code with params. */
    followUpError: jsonb('follow_up_error').$type<{
      code: string;
      params: Record<string, unknown>;
    }>(),
  },
  (t) => [
    primaryKey({ columns: [t.findingId, t.batchId] }),
    index('finding_decisions_batch').on(t.batchId),
    check(
      'finding_decisions_follow_up_status',
      sql.raw(`follow_up_status in (${FOLLOW_UP_STATUSES.map((s) => `'${s}'`).join(', ')})`),
    ),
  ],
);
