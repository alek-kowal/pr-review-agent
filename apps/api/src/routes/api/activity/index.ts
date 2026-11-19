// S-03-T7: Activity → In progress: every queued and running run with its stage and cost so far.
import { activeRuns, RUN_STATUSES, runWaitsOf } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { iso, roundLevel, RoundLevelSchema } from '../../../pr-view/round.ts';

const timestamp = z.iso.datetime({ offset: true });

export const InProgressResponse = z.object({
  runs: z.array(
    z.object({
      id: z.number().int(),
      kind: z.string(),
      status: z.enum(RUN_STATUSES),
      /** Round number in its chain; null for runs that are not rounds. */
      roundNumber: z.number().int().nullable(),
      level: RoundLevelSchema,
      /** The running stage, or the next one between two stages; null while queued. */
      currentStage: z.string().nullable(),
      /** Grows per agent turn while a session runs. */
      costUsd: z.number(),
      /** Why the run waits (S-10: `paused`, `budget_reached`, `slots_busy`); null when it does not. */
      wait: z.object({ code: z.string(), params: z.record(z.string(), z.unknown()) }).nullable(),
      createdAt: timestamp,
      startedAt: timestamp.nullable(),
      pullRequest: z.object({
        repository: z.object({ slug: z.string() }),
        number: z.number().int(),
        title: z.string(),
      }),
    }),
  ),
});

const activity: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.deps;
  fastify.get('/in-progress', { schema: { response: { 200: InProgressResponse } } }, async () => {
    const rows = await activeRuns(db);
    const waits = await runWaitsOf(
      db,
      rows.map(({ run }) => run.id),
    );
    return {
      runs: rows.map(({ run, pullRequest, repositorySlug }) => ({
        wait: waits.get(run.id)?.reason ?? null,
        id: run.id,
        kind: run.kind,
        status: run.status,
        roundNumber: run.roundNo,
        level: roundLevel(run),
        currentStage: run.currentStage,
        costUsd: run.costUsd,
        createdAt: run.createdAt.toISOString(),
        startedAt: iso(run.startedAt),
        pullRequest: {
          repository: { slug: repositorySlug },
          number: pullRequest.number,
          title: pullRequest.title,
        },
      })),
    };
  });
};

export default activity;
