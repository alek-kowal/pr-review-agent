// Worker entry (`pnpm dev`): builds dependencies from env, starts the job handlers and stops
// gracefully on SIGTERM or SIGINT.
import { closeDb, createDb, createQueue } from '@pra/db';
import { createLogger } from '@pra/integrations/logging';
import { startWorker } from './worker.ts';

const logger = createLogger('worker');
const url = process.env.DATABASE_URL;
if (!url) {
  logger.fatal('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const db = createDb(url, {
  onPoolError: (error) => logger.warn({ err: error }, 'idle database connection failed'),
});
const queue = createQueue(url);

let worker: Awaited<ReturnType<typeof startWorker>>;
try {
  worker = await startWorker({ db, queue, logger });
} catch (error) {
  logger.fatal({ err: error }, 'worker failed to start (has `pnpm db:migrate` run?)');
  await closeDb(db);
  process.exit(1);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'worker stopping');
    void worker
      .stop()
      .then(() => closeDb(db))
      .then(() => process.exit(0));
  });
}
