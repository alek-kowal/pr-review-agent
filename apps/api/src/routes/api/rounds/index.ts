// S-07-T4: Start review by hand and the PR's level. Both are unsigned, so they are recorded as
// "by hand": a manual start begins a new chain at round 1 (its `run_started` entry names the
// trigger), and a level change applies to the next round only (FR-059).
import { HAND, LEVEL_NUMBERS, type LevelNumber } from '@pra/core';
import {
  findPullRequest,
  loadPrStateInput,
  recordTimelineEntry,
  setPullRequestLevel,
  startRound,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { HeadSchema, headView } from '../../../pr-view/sections/head.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...`, so not under the folder name. */
export const autoPrefix = '/api';

const Level = z.union(LEVEL_NUMBERS.map((n) => z.literal(n)));

export const StartReviewResponse = z.object({
  runId: z.number().int(),
  chainId: z.string(),
  roundNumber: z.number().int(),
  level: Level,
});

export const PrLevelResponse = z.object({ head: HeadSchema });

const errors = { 404: ApiErrorSchema, 409: ApiErrorSchema };

const rounds: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, queue } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/start-review',
    {
      schema: {
        params: PrParams,
        body: z.object({ level: Level }),
        response: { 201: StartReviewResponse, ...errors },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const started = await startRound(
        { db, queue },
        {
          pullRequestId: found.pullRequest.id,
          trigger: 'manual',
          startedBy: HAND,
          level: request.body.level,
        },
      );
      if (!started.started) {
        const { code, params } = started.reason;
        if (code === 'run_active') return sendError(reply, 409, ApiErrorCode.RunActive, params);
        if (code === 'pr_closed') return sendError(reply, 409, ApiErrorCode.PrClosed, params);
        return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      }
      return reply.code(201).send({
        runId: started.run.id,
        chainId: started.run.chainId!,
        roundNumber: started.roundNumber,
        level: started.run.level.number as LevelNumber,
      });
    },
  );

  fastify.put(
    '/prs/:repo/:number/level',
    {
      schema: {
        params: PrParams,
        body: z.object({ level: Level.nullable() }),
        response: { 200: PrLevelResponse, ...errors },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const { pullRequest } = found;
      const { level } = request.body;
      if ((pullRequest.level ?? null) !== level) {
        await db.transaction(async (tx) => {
          await setPullRequestLevel(tx, pullRequest.id, level);
          await recordTimelineEntry(tx, {
            pullRequestId: pullRequest.id,
            actor: HAND,
            kind: 'pr_level_changed',
            params: { from: pullRequest.level ?? null, to: level },
            sourceKey: `pr-level:${randomUUID()}`,
          });
        });
      }
      const load = await loadPrStateInput(db, pullRequest.id);
      if (!load) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      return { head: headView(load) };
    },
  );
};

export default rounds;
