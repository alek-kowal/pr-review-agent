// Production entry and composition root (`pnpm dev`, `pnpm start`): builds the dependencies from
// env, then the server, and listens. Postgres may be down: the pool connects lazily and the queue
// keeps retrying in the background, so `/health` can report it.
import { closeDb, createDb, createQueue } from '@pra/db';
import { createLogger } from '@pra/integrations/logging';
import { buildServer } from './server.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  createLogger('api').fatal('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const db = createDb(url, {
  onPoolError: (error) => server.log.warn({ err: error }, 'idle database connection failed'),
});
// Sending only: the worker runs supervision and schedules.
const queue = createQueue(url, { supervise: false, schedule: false });
const server = await buildServer({ db, queue });

let stopping = false;

queue.on('error', (error) => server.log.error({ err: error }, 'queue error'));
queue.on('warning', (warning) => server.log.warn({ warning }, 'queue warning'));
// Retries with backoff (up to 30 s apart) until Postgres is reachable; `stop()` cancels it.
queue.start({ attempts: Number.MAX_SAFE_INTEGER }).then(
  () => server.log.info('queue started'),
  (error: unknown) => {
    if (!stopping) server.log.error({ err: error }, 'queue failed to start');
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.log.info({ signal }, 'api stopping');
    void server
      .close()
      .then(() => queue.stop({ graceful: false }))
      .then(() => closeDb(db))
      .then(() => process.exit(0));
  });
}

try {
  await server.listen({
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || 'localhost',
  });
} catch (error) {
  server.log.fatal({ err: error }, 'api failed to start');
  process.exit(1);
}
