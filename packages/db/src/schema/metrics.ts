import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { githubEvents, pullRequests } from './repositories.ts';

/**
 * Every move of a PR's head (S-19-T1, metric 5): written from `synchronize` events by
 * `recordHeadChange`, once per GitHub event. `by_bot` is a push by a GitHub App or bot account;
 * `is_base_merge` an "Update branch" merge of the base into the head.
 */
export const headChanges = pgTable(
  'head_changes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** The event it comes from; a retried event or a backfill writes nothing twice. */
    githubEventId: integer('github_event_id').references(() => githubEvents.id, {
      onDelete: 'set null',
    }),
    beforeSha: text('before_sha').notNull(),
    afterSha: text('after_sha').notNull(),
    /** The pusher's GitHub login; null when the payload has no sender. */
    pusher: text(),
    byBot: boolean('by_bot').notNull(),
    isBaseMerge: boolean('is_base_merge').notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('head_changes_pull_request').on(t.pullRequestId, t.at, t.id),
    unique('head_changes_github_event').on(t.githubEventId),
  ],
);
