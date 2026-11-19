import { sql } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

const HealthOk = z.object({ status: z.literal('ok'), db: z.literal('ok') });
const HealthDegraded = z.object({ status: z.literal('degraded'), db: z.literal('down') });

/** Liveness and database reachability, for the access gate, deploy checks and Compose. */
const health: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  fastify.get(
    '/health',
    { schema: { response: { 200: HealthOk, 503: HealthDegraded } } },
    async (request, reply) => {
      try {
        await fastify.deps.db.execute(sql`select 1`);
        return { status: 'ok' as const, db: 'ok' as const };
      } catch (error) {
        request.log.warn({ err: error }, 'health check: database unreachable');
        return reply.code(503).send({ status: 'degraded', db: 'down' });
      }
    },
  );
};

export default health;
