import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/**
 * `GET /api/live` (S-03-T2): Server-Sent Events. Every row change on a watched table arrives as
 * `event: change` with `{ table, id, prId, runId }`; `event: resync` asks the client to refetch
 * everything; a `: heartbeat` comment every 15 s keeps proxies from closing the stream.
 * Connecting writes nothing.
 */
const live: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  fastify.get('/', { schema: { hide: true } }, async (request, reply) => {
    await fastify.live.subscribe();
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    // Sent once the subscription listens, so a client that sees it misses no later change.
    stream.write('retry: 3000\n: connected\n\n');
    const remove = fastify.live.hub.add(stream);
    request.raw.on('close', () => {
      remove();
      stream.end();
    });
  });
};

export default live;
