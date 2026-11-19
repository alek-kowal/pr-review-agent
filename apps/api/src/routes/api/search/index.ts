import { searchPullRequests } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

const SearchQuery = z.object({ q: z.string().max(200).default('') });

export const SearchResponse = z.object({
  pullRequests: z.array(
    z.object({
      repository: z.object({ slug: z.string() }),
      number: z.number().int(),
      title: z.string(),
      /** The GitHub login, and the Team name when an active member has it. */
      author: z.object({ login: z.string(), name: z.string().nullable() }),
      state: z.enum(['open', 'closed', 'merged']),
    }),
  ),
});

/**
 * `GET /api/search?q=`: the command palette's PRs (S-17-T5), matched on number, title words and
 * author. An exact number comes first. Only reads.
 */
const search: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  fastify.get(
    '/',
    { schema: { querystring: SearchQuery, response: { 200: SearchResponse } } },
    async (request) => {
      const hits = await searchPullRequests(db, request.query.q);
      return {
        pullRequests: hits.map((hit) => ({
          repository: { slug: hit.repositorySlug },
          number: hit.number,
          title: hit.title,
          author: { login: hit.authorLogin, name: hit.authorName },
          state: hit.state,
        })),
      };
    },
  );
};

export default search;
