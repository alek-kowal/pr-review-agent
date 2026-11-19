import { listenChanges, type ChangeListener } from '@pra/db';
import fp from 'fastify-plugin';
import { LiveHub } from '../live/hub.ts';

declare module 'fastify' {
  interface FastifyInstance {
    live: {
      hub: LiveHub;
      /** Starts the one shared change subscription (once) and resolves when it listens. */
      subscribe(): Promise<void>;
    };
  }
}

/**
 * The live hub (S-03-T2) and its one `listenChanges` subscription. The subscription starts with
 * the first SSE client, so an api that never streams opens no LISTEN connection, and it closes
 * with the app. After a dropped connection clients get `resync`: changes in the gap were lost.
 */
export default fp(
  async (fastify) => {
    const hub = fastify.deps.live ?? new LiveHub();
    let listener: ChangeListener | null = null;

    fastify.decorate('live', {
      hub,
      subscribe() {
        listener ??= listenChanges(fastify.deps.db, (change) => hub.broadcast('change', change), {
          onReconnect: () => hub.broadcast('resync', {}),
          onError: (error) => fastify.log.warn({ err: error }, 'live listener dropped'),
        });
        return listener.ready;
      },
    });

    // Open streams would keep `close()` waiting; end them first.
    fastify.addHook('preClose', async () => hub.close());
    fastify.addHook('onClose', async () => {
      await listener?.close();
    });
  },
  { name: 'live' },
);
