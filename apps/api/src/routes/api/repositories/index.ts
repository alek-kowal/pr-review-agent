import { listRepositories } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { RepositoryRefSchema, repositoryRef } from '../../../pr-view/sections/pull-request.ts';

export const RepositoriesResponse = z.object({ repositories: z.array(RepositoryRefSchema) });

/** Connected repositories, for the repository filter. */
const repositories: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  fastify.get('/', { schema: { response: { 200: RepositoriesResponse } } }, async () => ({
    repositories: (await listRepositories(fastify.deps.db)).map(repositoryRef),
  }));
};

export default repositories;
