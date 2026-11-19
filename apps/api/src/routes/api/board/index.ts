import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BoardQuery, BoardResponse, buildBoard } from '../../../board/board.ts';

/**
 * `GET /api/board`: four lanes of cards, and the PRs merged or closed in the last 7 days, narrowed
 * by `?person=&repo=&forks=&level=&drafts=` (S-17-T3). An invalid filter answers 400.
 */
const board: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  fastify.get(
    '/',
    { schema: { querystring: BoardQuery, response: { 200: BoardResponse } } },
    async (request) => buildBoard(db, new Date(), request.query),
  );
};

export default board;
