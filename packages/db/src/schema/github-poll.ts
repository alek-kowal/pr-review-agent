// P-28: the GitHub poller's state, used only without the GitHub App. Switching to the App leaves it
// as it is; nothing reads it then.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { repositories } from './repositories.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One row (id 1): the poller as a whole. */
export const githubPoller = pgTable(
  'github_poller',
  {
    id: integer().primaryKey().default(1),
    /** A poll holds the lease until this time; an overlapping poll finds it held and skips. */
    leaseUntil: at('lease_until'),
    lastStartedAt: at('last_started_at'),
    lastFinishedAt: at('last_finished_at'),
    /** The last poll's failure `{ code, params }`; null when it went through. */
    lastError: jsonb('last_error').$type<{ code: string; params: Record<string, unknown> }>(),
    /** No poll before this time: GitHub's rate limit is used up until then. */
    backoffUntil: at('backoff_until'),
    /** GitHub's rate limit as the last poll saw it. */
    rateLimit: jsonb('rate_limit').$type<{ limit: number; remaining: number; resetAt: string }>(),
  },
  (t) => [check('github_poller_single_row', sql`${t.id} = 1`)],
);

/** Per connected repository: when its first poll (the baseline) and its last poll were. */
export const githubPollRepositories = pgTable('github_poll_repositories', {
  repositoryId: integer('repository_id')
    .primaryKey()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  baselineAt: at('baseline_at').notNull(),
  lastPolledAt: at('last_polled_at').notNull(),
});

/** The last seen state of each PR the poller knows; a closed one stays, so a reopen is seen. */
export const githubPollPullRequests = pgTable(
  'github_poll_pull_requests',
  {
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    headSha: text('head_sha').notNull(),
    isDraft: boolean('is_draft').notNull(),
    /** `open`, `closed` or `merged`. */
    state: text().notNull(),
    /** GitHub's `updated_at` when it was seen. */
    githubUpdatedAt: at('github_updated_at').notNull(),
    seenAt: at('seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.number] })],
);
