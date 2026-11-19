// Worker entry (`pnpm dev`): logs with the shared pino options and stops on SIGTERM or SIGINT.
import { createLogger } from '@pra/integrations/logging';

const logger = createLogger('worker');
logger.info('worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'worker stopped');
    process.exit(0);
  });
}

// Keeps the process alive until a signal arrives; F-02-T4 replaces this with the job queue.
setInterval(() => {}, 1 << 30);
