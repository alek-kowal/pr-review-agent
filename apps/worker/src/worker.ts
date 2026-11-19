import { JOBS, type Db, type JobPayloads, type Queue } from '@pra/db';
import type { Logger } from '@pra/integrations/logging';
import { handleSmoke } from './handlers/smoke.ts';

export type WorkerDeps = { db: Db; queue: Queue; logger: Logger };

export type WorkerOptions = {
  /** How often each job handler polls for new jobs; pg-boss's default (and minimum 0.5) applies. */
  pollingIntervalSeconds?: number;
};

export type RunningWorker = { stop: () => Promise<void> };

/**
 * Starts the queue and subscribes every job handler. The queue must already be installed by
 * `pnpm db:migrate`. `stop()` waits for running jobs, then stops the queue.
 */
export async function startWorker(
  deps: WorkerDeps,
  options: WorkerOptions = {},
): Promise<RunningWorker> {
  const { queue, logger } = deps;
  // pg-boss rejects an explicit `undefined`, so the key is set only when given.
  const work =
    options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds };

  queue.on('error', (error) => logger.error({ err: error }, 'queue error'));
  await queue.start();
  await queue.work<JobPayloads['smoke']>(JOBS.smoke, work, (jobs) => handleSmoke(deps, jobs));
  logger.info({ jobs: Object.values(JOBS) }, 'worker started');

  return {
    async stop() {
      await queue.stop({ graceful: true });
      logger.info('worker stopped');
    },
  };
}
