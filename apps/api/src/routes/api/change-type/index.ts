// S-04-T6: a person forces the PR's change type for its next round (FR-030), or clears it. Unsigned,
// so the timeline records it "by hand".
import { CHANGE_TYPES, HAND } from '@pra/core';
import { findPullRequest, recordTimelineEntry, setForcedChangeType } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { checksSection, ChecksSectionSchema } from '../../../pr-view/sections/checks.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...`, so not under the folder name. */
export const autoPrefix = '/api';

export const ChangeTypeBody = z.object({ changeType: z.enum(CHANGE_TYPES).nullable() });
export const ChangeTypeResponse = z.object({ checks: ChecksSectionSchema });

const changeType: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.put(
    '/prs/:repo/:number/change-type',
    {
      schema: {
        params: PrParams,
        body: ChangeTypeBody,
        response: { 200: ChangeTypeResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const { repository, pullRequest } = found;
      const from = pullRequest.forcedChangeType ?? null;
      const to = request.body.changeType;
      if (from !== to) {
        await db.transaction(async (tx) => {
          await setForcedChangeType(tx, pullRequest.id, to);
          await recordTimelineEntry(tx, {
            pullRequestId: pullRequest.id,
            actor: HAND,
            kind: 'change_type_forced',
            params: { from, to },
            sourceKey: `change-type:${randomUUID()}`,
          });
        });
      }
      const checks = await checksSection.build({
        db,
        repository,
        pullRequest: { ...pullRequest, forcedChangeType: to },
      });
      return { checks };
    },
  );
};

export default changeType;
