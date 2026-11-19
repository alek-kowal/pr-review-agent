// Trials (S-22-T6): two runs of kind `trial` on one commit of a PR. Run A reads the active
// instructions; run B reads them with one file's draft in place of its active version.
import { ACTOR_KINDS } from '@pra/core';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { instructionVersions } from './instructions.ts';
import { pullRequests } from './repositories.ts';
import { runs } from './runs.ts';
import { teamMembers } from './team.ts';

export const trials = pgTable(
  'trials',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** The draft run B reads in place of its file's active version. */
    draftVersionId: integer('draft_version_id')
      .notNull()
      .references(() => instructionVersions.id, { onDelete: 'cascade' }),
    /** The commit both runs review. */
    headSha: text('head_sha').notNull(),
    runAId: integer('run_a_id').references(() => runs.id, { onDelete: 'set null' }),
    runBId: integer('run_b_id').references(() => runs.id, { onDelete: 'set null' }),
    /** A trial starts unsigned: "Started by hand". */
    startedBy: text('started_by', { enum: ACTOR_KINDS }).notNull().default('hand'),
    startedByMemberId: uuid('started_by_member_id').references(() => teamMembers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trials_pull_request').on(t.pullRequestId),
    index('trials_run_a').on(t.runAId),
    index('trials_run_b').on(t.runBId),
    check('trials_started_by', sql`${t.startedBy} in ('member', 'bot', 'hand')`),
  ],
);
