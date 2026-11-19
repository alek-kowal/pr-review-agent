// S-23-T4: `POST /api/prs/:repo/:number/analyst` runs the analyst by hand on a closed PR, unsigned
// ("by hand"). The worker records the candidates when the run ends.
import { findPullRequest, startAnalysis } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { PrParams } from '../prs/index.ts';

export const autoPrefix = '/api';

const StartResponse = z.object({ analysisId: z.number(), runId: z.number() });

const analystRoutes: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, queue } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/analyst',
    {
      schema: {
        params: PrParams,
        response: { 202: StartResponse, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const started = await startAnalysis(
        { db, queue, logger: request.log },
        { pullRequestId: found.pullRequest.id, startedBy: 'hand' },
      );
      if (!started.started) {
        if (started.reason === 'pr_open') return sendError(reply, 409, ApiErrorCode.PrOpen);
        return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      }
      reply.code(202);
      return { analysisId: started.analysis.id, runId: started.run.id };
    },
  );
};

export default analystRoutes;
