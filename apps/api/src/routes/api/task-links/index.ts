// S-06-T4: link a PR's ClickUp task by hand. Unsigned (recorded "by hand"); the task is checked
// with `getTask`, replaces an earlier link, and the next round's Task stage uses it.
import { HAND, taskIdFromRef } from '@pra/core';
import {
  findPullRequest,
  readRepositoryConfig,
  recordTimelineEntry,
  upsertTaskLink,
} from '@pra/db';
import { CLICKUP_AUTH_FAILED, CLICKUP_NOT_CONFIGURED } from '@pra/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { TaskSectionSchema, taskLinkView } from '../../../pr-view/sections/task.ts';
import { PrParams } from '../prs/index.ts';

export const autoPrefix = '/api';

export const TaskLinkBody = z.object({
  /** A task id (`WB-123`, `86c1abc`) or a ClickUp task link. */
  taskIdOrUrl: z.string().min(1).max(500),
});

export const TaskLinkResponse = z.object({ task: TaskSectionSchema });

const taskLinks: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, clickup } = fastify.deps;

  fastify.put(
    '/prs/:repo/:number/task-link',
    {
      schema: {
        params: PrParams,
        body: TaskLinkBody,
        response: {
          200: TaskLinkResponse,
          404: ApiErrorSchema,
          422: ApiErrorSchema,
          502: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const settings = readRepositoryConfig(found.repository).value.clickup;
      if (!settings) {
        return sendError(reply, 422, ApiErrorCode.ClickupNotConfigured, {
          missing: ['RepositoryConfig.clickup'],
        });
      }
      const taskId = taskIdFromRef(request.body.taskIdOrUrl);
      if (!taskId) return sendError(reply, 422, ApiErrorCode.TaskRefInvalid);

      let task;
      try {
        task = await clickup.getTask(settings, taskId);
      } catch (error) {
        const failure = integrationFailure(error);
        if (!failure) throw error;
        request.log.info({ err: error }, 'ClickUp task lookup failed');
        if (failure.code === CLICKUP_NOT_CONFIGURED) {
          return sendError(reply, 422, ApiErrorCode.ClickupNotConfigured, failure.params);
        }
        const code =
          failure.code === CLICKUP_AUTH_FAILED
            ? ApiErrorCode.ClickupAuthFailed
            : ApiErrorCode.ClickupError;
        return sendError(reply, 502, code, failure.params);
      }
      if (!task) return sendError(reply, 422, ApiErrorCode.TaskNotFound, { taskId });

      const link = await db.transaction(async (tx) => {
        const row = await upsertTaskLink(tx, {
          pullRequestId: found.pullRequest.id,
          taskId: task.customId ?? task.id,
          url: task.url,
          name: task.name,
          how: 'hand',
          linkedBy: 'hand',
          linkedByMemberId: null,
        });
        await recordTimelineEntry(tx, {
          pullRequestId: found.pullRequest.id,
          actor: HAND,
          kind: 'task_linked',
          params: { taskId: row.taskId, name: row.name, url: row.url },
          at: row.createdAt,
          sourceKey: `task_link:${row.createdAt.toISOString()}`,
        });
        return row;
      });
      return { task: { configured: true, link: taskLinkView(link) } };
    },
  );
};

/**
 * An `IntegrationError`'s code and params, by shape: autoload imports routes through their own
 * module graph, so `instanceof` can miss the gateway's class.
 */
function integrationFailure(
  error: unknown,
): { code: string; params: Record<string, unknown> } | null {
  const failure = error as { name?: unknown; code?: unknown; params?: unknown } | null;
  if (!(error instanceof Error) || !String(failure?.name).startsWith('Integration')) return null;
  if (typeof failure?.code !== 'string') return null;
  const params =
    failure.params && typeof failure.params === 'object' && !Array.isArray(failure.params)
      ? (failure.params as Record<string, unknown>)
      : {};
  return { code: failure.code, params };
}

export default taskLinks;
