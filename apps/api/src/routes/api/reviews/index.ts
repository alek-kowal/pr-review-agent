// S-08-T4: signed opinions on findings, saved together as one signed review (FR-037, FR-038).
import { findPullRequest, lockActiveTeamMember, OPINIONS, saveReview } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { DecisionResult, refreshedView } from '../decisions/index.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...`, so not under the folder name. */
export const autoPrefix = '/api';

const ReviewBody = z.object({
  opinions: z
    .array(
      z.object({
        findingId: z.number().int().positive(),
        value: z.enum(OPINIONS),
        comment: z
          .string()
          .trim()
          .max(2000)
          .nullish()
          .transform((comment) => (comment ? comment : null)),
      }),
    )
    .min(1)
    .max(200),
  /** The signing Team member; checked by the api, so a missing one is `signature_required`. */
  signedBy: z.string().trim().optional(),
});

export const ReviewSchema = z.object({
  id: z.number().int(),
  signedBy: z.object({ id: z.string(), name: z.string() }),
  worth: z.number().int(),
  notWorth: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const ReviewResponse = DecisionResult.extend({ review: ReviewSchema });

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema };

const reviewsRoute: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/reviews',
    {
      schema: { params: PrParams, body: ReviewBody, response: { 200: ReviewResponse, ...errors } },
    },
    async (request, reply) => {
      const { opinions, signedBy } = request.body;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      const ids = opinions.map((o) => o.findingId);
      if (new Set(ids).size !== ids.length) {
        return sendError(reply, 400, ApiErrorCode.InvalidRequest, { duplicate: 'findingId' });
      }
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);

      const result = await db.transaction(async (tx) => {
        // Locked, so the signer cannot be removed while their review is written.
        const signer = await lockActiveTeamMember(tx, signedBy);
        if (!signer) return { ok: false, reason: 'signer_unknown' } as const;
        const saved = await saveReview(tx, {
          pullRequestId: found.pullRequest.id,
          opinions,
          signedBy: signer.id,
        });
        return saved.ok ? { ...saved, signerName: signer.name } : saved;
      });

      if (!result.ok) {
        return result.reason === 'signer_unknown'
          ? sendError(reply, 400, ApiErrorCode.SignerUnknown, { signer: signedBy })
          : sendError(reply, 404, ApiErrorCode.FindingNotFound, { missing: result.missing });
      }
      const { review } = result;
      return {
        review: {
          id: review.id,
          signedBy: { id: review.signedBy, name: result.signerName },
          worth: review.worth,
          notWorth: review.notWorth,
          createdAt: review.createdAt.toISOString(),
        },
        ...(await refreshedView(db, found.pullRequest.id)),
      };
    },
  );
};

export default reviewsRoute;
