import { ACTOR_KINDS, LANES, PR_STATES } from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { runs } from './runs.ts';
import { teamMembers } from './team.ts';

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/**
 * One line of a PR's Timeline tab (S-03-T5): what happened, who did it and, for run ends, what
 * the run cost. Entries sort by `(at, id)`. Every writer gives a `source_key` (the event, run or
 * batch it comes from), so a retried hook or event writes nothing twice.
 */
export const timelineEntries = pgTable(
  'timeline_entries',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** `member` (with `member_id`), `bot`, or `hand` (unsigned, or GitHub with `params.via`). */
    actor: text({ enum: ACTOR_KINDS }).notNull(),
    memberId: uuid('member_id').references(() => teamMembers.id),
    /** What happened, for example `pr_ready` or `round_finished`; the web maps it to copy. */
    kind: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    runId: integer('run_id').references(() => runs.id, { onDelete: 'set null' }),
    /** A finished run's final cost. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    sourceKey: text('source_key').notNull(),
  },
  (t) => [
    unique('timeline_entries_source').on(t.pullRequestId, t.sourceKey),
    index('timeline_entries_pull_request').on(t.pullRequestId, t.at, t.id),
    check('timeline_entries_actor', sql.raw(`actor in (${inList(ACTOR_KINDS)})`)),
    check('timeline_entries_member', sql`(${t.actor} = 'member') = (${t.memberId} is not null)`),
  ],
);

/**
 * The PR's state over time (metric 2, "Ready → merge"): one row each time core `prState` gives a
 * new state. Written only by `recordStateChange`.
 */
export const prStateChanges = pgTable(
  'pr_state_changes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    state: text({ enum: PR_STATES }).notNull(),
    /** The board lane; null when the PR left the board (merged or closed). */
    lane: text({ enum: LANES }),
    /** What moved it, for example `{ code: 'round_started' }`. */
    reason: jsonb().$type<{ code: string; params: Record<string, unknown> }>().notNull(),
    headSha: text('head_sha').notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pr_state_changes_pull_request').on(t.pullRequestId, t.at, t.id),
    check('pr_state_changes_state', sql.raw(`state in (${inList(PR_STATES)})`)),
  ],
);
