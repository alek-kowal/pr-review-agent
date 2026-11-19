// Level 5 autofix (S-15-T1): what the bot did at each autofix point, and the shadow log of what it
// would have done at levels 3–4.
import type { AutofixPoint, Reason } from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { roundChains } from './chains.ts';
import { patches } from './patches.ts';
import { pullRequests, repositories } from './repositories.ts';
import { runs } from './runs.ts';

export const AUTOFIX_POINTS = ['start', 'push'] as const satisfies readonly AutofixPoint[];
export const AUTOFIX_OUTCOMES = ['started', 'pushed', 'waiting'] as const;
export type AutofixOutcome = (typeof AUTOFIX_OUTCOMES)[number];
export const SHADOW_DECISIONS = ['would_start', 'would_push', 'would_wait'] as const;
export type ShadowDecision = (typeof SHADOW_DECISIONS)[number];

const at = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * One level 5 autofix decision: the start after a round (`started` or `waiting`) or the push of
 * its patch (`pushed` or `waiting`). The latest `waiting` of a patch is the banner's reason.
 */
export const autofixAttempts = pgTable(
  'autofix_attempts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    chainId: uuid('chain_id').references(() => roundChains.id, { onDelete: 'cascade' }),
    /** The round whose end the start point read. */
    roundRunId: integer('round_run_id').references(() => runs.id, { onDelete: 'cascade' }),
    /** The bot's implementer run (start `started`, and every push point). */
    implementerRunId: integer('implementer_run_id').references(() => runs.id, {
      onDelete: 'cascade',
    }),
    patchId: integer('patch_id').references(() => patches.id, { onDelete: 'cascade' }),
    point: text({ enum: AUTOFIX_POINTS }).notNull(),
    outcome: text({ enum: AUTOFIX_OUTCOMES }).notNull(),
    /** Every hold for `waiting`; the "conditions met" reason otherwise. */
    reasons: jsonb().$type<Reason[]>().notNull(),
    /** The pushed commit (`pushed`). */
    sha: text(),
    at: at(),
  },
  (t) => [
    index('autofix_attempts_pull_request').on(t.pullRequestId, t.at),
    index('autofix_attempts_chain').on(t.chainId),
    index('autofix_attempts_patch').on(t.patchId, t.at),
    // One start decision per round; a hook that fires twice adds nothing.
    uniqueIndex('autofix_attempts_round_start')
      .on(t.roundRunId)
      .where(sql`${t.point} = 'start'`),
    check('autofix_attempts_point', sql`${t.point} in ('start', 'push')`),
    check('autofix_attempts_outcome', sql`${t.outcome} in ('started', 'pushed', 'waiting')`),
  ],
);

/**
 * What level 5 would have done at levels 3–4 (start at a round's end, push at a person's patch).
 * Nothing acts on it: it feeds the PR Timeline and Insights → Trust ladder.
 */
export const autofixShadow = pgTable(
  'autofix_shadow',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    /** The round (start point). */
    runId: integer('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    /** The person's patch (push point). */
    patchId: integer('patch_id').references(() => patches.id, { onDelete: 'cascade' }),
    /** The PR's level when it was checked (the run's frozen level). */
    level: integer().notNull(),
    point: text({ enum: AUTOFIX_POINTS }).notNull(),
    decision: text({ enum: SHADOW_DECISIONS }).notNull(),
    reasons: jsonb().$type<Reason[]>().notNull(),
    /** Findings it would fix (start) or the patch fixed (push), out of `total`. */
    fixed: integer().notNull(),
    total: integer().notNull(),
    at: at(),
  },
  (t) => [
    index('autofix_shadow_pull_request').on(t.pullRequestId, t.at),
    index('autofix_shadow_repository').on(t.repositoryId, t.at),
    uniqueIndex('autofix_shadow_run_start')
      .on(t.runId)
      .where(sql`${t.point} = 'start'`),
    uniqueIndex('autofix_shadow_patch_push')
      .on(t.patchId)
      .where(sql`${t.point} = 'push'`),
    check('autofix_shadow_point', sql`${t.point} in ('start', 'push')`),
    check(
      'autofix_shadow_decision',
      sql`${t.decision} in ('would_start', 'would_push', 'would_wait')`,
    ),
  ],
);
