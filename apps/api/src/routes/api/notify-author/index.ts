// S-08-T10 (FR-039): Notify author. After a signed review, one ClickUp comment on the PR's linked
// task mentions the author's ClickUp user and names the review's signer (core `notifyText`). The
// preview returns the exact text the post sends. Unsigned (recorded "by hand"); once per review.
import { HAND, notifyText } from '@pra/core';
import {
  claimReviewNotification,
  findPullRequest,
  getActiveTeamMember,
  getReview,
  getTaskLink,
  prAuthor,
  readRepositoryConfig,
  recordTimelineEntry,
  releaseReviewNotification,
  type Executor,
  type PullRequest,
  type ReviewRow,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { integrationFailure, sendClickUpFailure } from '../../../integration-failure.ts';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...`, so not under the folder name. */
export const autoPrefix = '/api';

const ReviewId = z.coerce.number().int().positive();

export const NotificationSchema = z.object({
  reviewId: z.number().int(),
  /** The linked task's id as shown (custom id such as `WB-123` when it has one). */
  taskId: z.string(),
  /** The author's Team name. */
  author: z.string(),
  /** The comment exactly as posted. */
  text: z.string(),
  /** When it was posted; null until then. */
  notifiedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const NotificationResponse = z.object({ notification: NotificationSchema });

const errors = { 404: ApiErrorSchema, 409: ApiErrorSchema };

type Plan =
  | { ok: true; notification: z.infer<typeof NotificationSchema>; mentionUserId: string }
  | { ok: false; status: 404 | 409; code: ApiErrorCode; params: Record<string, unknown> };

/** What Notify author would post for the review, or why it cannot (no gateway call). */
async function plan(db: Executor, pullRequest: PullRequest, reviewId: number): Promise<Plan> {
  const review: ReviewRow | null = await getReview(db, reviewId);
  if (!review || review.pullRequestId !== pullRequest.id) {
    return { ok: false, status: 404, code: ApiErrorCode.ReviewNotFound, params: { reviewId } };
  }
  const link = await getTaskLink(db, pullRequest.id);
  if (!link) return { ok: false, status: 409, code: ApiErrorCode.NoLinkedTask, params: {} };
  const author = await prAuthor(db, pullRequest.id);
  const member = author.memberId ? await getActiveTeamMember(db, author.memberId) : undefined;
  if (!member?.clickupUserId) {
    return {
      ok: false,
      status: 409,
      code: ApiErrorCode.AuthorHasNoClickupUser,
      params: { author: author.name ?? author.login },
    };
  }
  return {
    ok: true,
    mentionUserId: member.clickupUserId,
    notification: {
      reviewId: review.id,
      taskId: review.notifiedTaskId ?? link.taskId,
      author: member.name,
      text: notifyText({
        author: member.name,
        signer: review.signerName,
        worth: review.worth,
        notWorth: review.notWorth,
        prNumber: pullRequest.number,
      }),
      notifiedAt: review.notifiedAt?.toISOString() ?? null,
    },
  };
}

const notifyAuthor: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, clickup } = fastify.deps;

  fastify.get(
    '/prs/:repo/:number/notify-author/preview',
    {
      schema: {
        params: PrParams,
        querystring: z.object({ reviewId: ReviewId }),
        response: { 200: NotificationResponse, ...errors },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const planned = await plan(db, found.pullRequest, request.query.reviewId);
      if (!planned.ok) return sendError(reply, planned.status, planned.code, planned.params);
      return { notification: planned.notification };
    },
  );

  fastify.post(
    '/prs/:repo/:number/notify-author',
    {
      schema: {
        params: PrParams,
        body: z.object({ reviewId: ReviewId }),
        response: {
          200: NotificationResponse,
          422: ApiErrorSchema,
          502: ApiErrorSchema,
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const { pullRequest } = found;
      const planned = await plan(db, pullRequest, request.body.reviewId);
      if (!planned.ok) return sendError(reply, planned.status, planned.code, planned.params);
      const { notification } = planned;
      // Posted already: once per review.
      if (notification.notifiedAt) return { notification };

      const settings = readRepositoryConfig(found.repository).value.clickup;
      if (!settings) {
        return sendError(reply, 422, ApiErrorCode.ClickupNotConfigured, {
          missing: ['RepositoryConfig.clickup'],
        });
      }
      // Claimed first, so a concurrent call posts nothing; a failed post gives the claim back.
      const claimed = await claimReviewNotification(db, notification.reviewId, notification.taskId);
      if (!claimed) {
        const again = await plan(db, pullRequest, notification.reviewId);
        return again.ok ? { notification: again.notification } : { notification };
      }
      try {
        await clickup.createComment(settings, notification.taskId, {
          text: notification.text,
          mentionUserId: planned.mentionUserId,
        });
      } catch (error) {
        await releaseReviewNotification(db, notification.reviewId);
        const failure = integrationFailure(error);
        if (!failure) throw error;
        request.log.info({ err: error }, 'ClickUp comment failed');
        return sendClickUpFailure(reply, failure);
      }
      await recordTimelineEntry(db, {
        pullRequestId: pullRequest.id,
        actor: HAND,
        kind: 'author_notified',
        params: {
          authorName: notification.author,
          taskId: notification.taskId,
          reviewId: notification.reviewId,
        },
        at: claimed.notifiedAt ?? new Date(),
        sourceKey: `author_notified:${notification.reviewId}`,
      });
      return {
        notification: {
          ...notification,
          notifiedAt: (claimed.notifiedAt ?? new Date()).toISOString(),
        },
      };
    },
  );
};

export default notifyAuthor;
