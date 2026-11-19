// S-07-T4: what the PR's results were measured on. The reviewed SHA against the head, commits
// since, the chain's rounds, the PR's level against the repository's default, and how many fixes
// the newest fix checks found resolved.
import { LEVEL_NUMBERS, MAX_CHAIN_ROUNDS, type LevelNumber } from '@pra/core';
import type { PrStateLoad } from '@pra/db';
import { z } from 'zod/v4';
import { defineSection } from '../section.ts';
import { prStateOf } from '../state.ts';

const Level = z.union(LEVEL_NUMBERS.map((n) => z.literal(n)));

export const HeadSchema = z.object({
  /** The head SHA of the latest completed round; null before one completed. */
  reviewedSha: z.string().nullable(),
  headSha: z.string(),
  /** Commits on the head since the reviewed SHA (FR-017). */
  commitsSince: z.number().int().nonnegative(),
  /** Completed rounds of the current chain, of `maxRounds`. */
  completedRounds: z.number().int().nonnegative(),
  maxRounds: z.number().int(),
  level: z.object({
    /** Set on the PR (FR-059); null follows the repository's default. */
    pr: Level.nullable(),
    repositoryDefault: Level,
    /** The level the next round starts at. */
    next: Level,
  }),
  /** Findings decided Implement that a fix check answered, and how many it found resolved. */
  fixes: z.object({ resolved: z.number().int(), total: z.number().int() }).nullable(),
});

export function headView(load: PrStateLoad): z.output<typeof HeadSchema> {
  const { pullRequest, input } = load;
  const implement = load.findings.filter((f) => load.decisions.get(f.id)?.decision === 'implement');
  const checked = implement.filter((f) => load.fixChecks.has(f.id));
  return {
    reviewedSha: input.reviewedSha,
    headSha: pullRequest.headSha,
    commitsSince: input.commitsSinceReview,
    completedRounds: input.chainRounds,
    maxRounds: MAX_CHAIN_ROUNDS,
    level: {
      pr: (pullRequest.level as LevelNumber | null) ?? null,
      repositoryDefault: load.defaultLevel,
      next: input.level,
    },
    fixes: checked.length
      ? {
          resolved: checked.filter((f) => load.fixChecks.get(f.id)?.resolved === true).length,
          total: checked.length,
        }
      : null,
  };
}

export const headSection = defineSection({
  key: 'head',
  schema: HeadSchema,
  build: async (context) => headView(await prStateOf(context)),
});
