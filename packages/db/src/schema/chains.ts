// P-11: review chains (S-07) and the fix statuses of their rounds.
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { findings, runs } from './runs.ts';

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

/**
 * A round's answer for one finding decided Implement: Resolved or Not resolved, and why. Fix checks
 * (rounds 2 and 3) and the full review of a new chain write it (FR-019, US-05).
 */
export const findingFixChecks = pgTable(
  'finding_fix_checks',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    resolved: boolean().notNull(),
    reason: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('finding_fix_checks_finding_run').on(t.findingId, t.runId),
    index('finding_fix_checks_run').on(t.runId),
  ],
);
