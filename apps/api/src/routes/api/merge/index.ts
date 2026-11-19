// S-12-T2: `POST /api/prs/:repo/:number/merge { typedNumber, signedBy }` (FR-055). The typed
// number must match, the merge is signed, and `mergePullRequest` re-checks fresh GitHub state.
import { findPullRequest } from '@pra/db';
import { GITHUB_NOT_CONFIGURED, IntegrationError } from '@pra/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { mergePullRequest } from '../../../merge/merge-pr.ts';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { PrParams } from '../prs/index.ts';

export const autoPrefix = '/api';

const MergeBody = z.object({
  typedNumber: z.coerce.number().int(),
  /** The signing Team member; checked by the api, so a missing one is `signature_required`. */
  signedBy: z.string().trim().optional(),
});

export const MergeResponse = z.object({
  sha: z.string(),
  mergeSha: z.string(),
  by: z.object({ id: z.string(), name: z.string() }),
});

const merge: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, github } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/merge',
    {
      schema: {
        params: PrParams,
        body: MergeBody,
        response: {
          200: MergeResponse,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
          422: ApiErrorSchema,
          502: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { repo, number } = request.params;
      const found = await findPullRequest(db, repo, number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      if (request.body.typedNumber !== number) {
        return sendError(reply, 400, ApiErrorCode.MergeNumberMismatch, { number });
      }
      const signedBy = request.body.signedBy;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      try {
        const outcome = await mergePullRequest(
          { db, github },
          { pullRequestId: found.pullRequest.id, signedBy },
        );
        if (!outcome.ok) return sendError(reply, outcome.status, outcome.code, outcome.params);
        const { sha, mergeSha, by } = outcome;
        return { sha, mergeSha, by };
      } catch (error) {
        if (error instanceof IntegrationError && error.code === GITHUB_NOT_CONFIGURED) {
          return sendError(reply, 503, ApiErrorCode.GithubNotConfigured, error.params);
        }
        request.log.warn({ err: error }, 'merge: GitHub failed');
        const status = (error as { status?: unknown } | null)?.status;
        return sendError(reply, 502, ApiErrorCode.GithubError, {
          ...(typeof status === 'number' ? { status } : {}),
        });
      }
    },
  );
};

export default merge;
