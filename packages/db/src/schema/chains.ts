// P-11: review chains (S-07).
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';

/**
 * A chain: the round that started it plus at most 2 automatic fix checks. `runs.chain_id` points
 * here. The next round starts by itself only when the PR's head is `expected_head_sha`, the commit
 * PR Review Agent pushed as a fix (S-14 sets it).
 */
export const roundChains = pgTable(
  'round_chains',
  {
    id: uuid().primaryKey().defaultRandom(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    expectedHeadSha: text('expected_head_sha'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('round_chains_pull_request').on(t.pullRequestId, t.createdAt)],
);
