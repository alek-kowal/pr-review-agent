import {
  findPullRequest,
  getRepositoryBySlug,
  listOpenPullRequests,
  loadPrStateInput,
  RUN_STATUSES,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { buildPrView, PrViewSchema } from '../../../pr-view/index.ts';
import { FindingsResponse, findingsView } from '../../../pr-view/findings.ts';
import { RepositoryRefSchema } from '../../../pr-view/sections/pull-request.ts';
import { timelineRoutes } from '../../../pr-view/timeline.ts';

export const PrParams = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

export const PrListResponse = z.object({
  pullRequests: z.array(
    z.object({
      repository: RepositoryRefSchema.pick({ slug: true }),
      number: z.number().int(),
      title: z.string(),
      authorLogin: z.string(),
      isDraft: z.boolean(),
      /** Status of the latest round; null before the first one. */
      latestRoundStatus: z.enum(RUN_STATUSES).nullable(),
    }),
  ),
});

export { FindingSchema, FindingsResponse, QuestionSchema } from '../../../pr-view/findings.ts';

/** Read endpoints for the PR list and the PR page. They never write. */
const prs: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get(
    '/',
    {
      schema: {
        querystring: z.object({ repo: z.string().min(1).optional() }),
        response: { 200: PrListResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      let repositoryId: number | undefined;
      if (request.query.repo !== undefined) {
        const repository = await getRepositoryBySlug(db, request.query.repo);
        if (!repository) {
          return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, {
            repo: request.query.repo,
          });
        }
        repositoryId = repository.id;
      }
      const rows = await listOpenPullRequests(db, { repositoryId });
      return {
        pullRequests: rows.map(({ repositorySlug, pullRequest, latestRoundStatus }) => ({
          repository: { slug: repositorySlug },
          number: pullRequest.number,
          title: pullRequest.title,
          authorLogin: pullRequest.authorLogin,
          isDraft: pullRequest.isDraft,
          latestRoundStatus,
        })),
      };
    },
  );

  fastify.get(
    '/:repo/:number',
    { schema: { params: PrParams, response: { 200: PrViewSchema, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      return buildPrView({ db, ...found });
    },
  );

  // S-03-T7: the Timeline tab.
  await fastify.register(timelineRoutes);

  fastify.get(
    '/:repo/:number/findings',
    { schema: { params: PrParams, response: { 200: FindingsResponse, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);

      const load = await loadPrStateInput(db, found.pullRequest.id);
      if (!load) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      return findingsView(load);
    },
  );
};

export default prs;
