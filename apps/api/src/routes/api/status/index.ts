// S-03-T7: the status chip: the factory's state and today's spend. Paused and budget states come
// with S-10 (P-16); until then the factory is always running.
import { spendSince } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

export const StatusResponse = z.object({
  state: z.enum(['running']),
  /** Cost of every agent session started since 00:00 UTC (the time zone setting is S-10). */
  todaySpendUsd: z.number(),
  /** Start of the day the spend counts from. */
  since: z.iso.datetime({ offset: true }),
});

/** 00:00 UTC of `now`'s day. */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const status: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.deps;
  fastify.get('/', { schema: { response: { 200: StatusResponse } } }, async () => {
    const since = startOfUtcDay(new Date());
    return {
      state: 'running' as const,
      todaySpendUsd: await spendSince(db, since),
      since: since.toISOString(),
    };
  });
};

export default status;
