import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BoardResponse, buildBoard } from '../../../board/board.ts';

/** `GET /api/board`: four lanes of cards, and the PRs merged or closed in the last 7 days. */
const board: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  fastify.get('/', { schema: { response: { 200: BoardResponse } } }, async () => buildBoard(db));
};

export default board;
