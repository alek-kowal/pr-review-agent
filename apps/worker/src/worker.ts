import { JOBS, type JobPayloads } from '@pra/db';
import { withDefaults, type WorkerDeps, type WorkerDepsInput } from './deps.ts';
import { handleGithubEvents } from './handlers/github-event.ts';
import { handleSmoke } from './handlers/smoke.ts';

export type { WorkerDeps, WorkerDepsInput };

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
  input: WorkerDepsInput,
  options: WorkerOptions = {},
): Promise<RunningWorker> {
  const deps = withDefaults(input);
  const { queue, logger } = deps;
  // pg-boss rejects an explicit `undefined`, so the key is set only when given.
  const work =
    options.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: options.pollingIntervalSeconds };

  queue.on('error', (error) => logger.error({ err: error }, 'queue error'));
  await queue.start();
  await queue.work<JobPayloads['smoke']>(JOBS.smoke, work, (jobs) => handleSmoke(deps, jobs));
  await queue.work<JobPayloads['github.event']>(JOBS.githubEvent, work, (jobs) =>
    handleGithubEvents(deps, jobs),
  );
  logger.info({ jobs: Object.values(JOBS) }, 'worker started');

  return {
    async stop() {
      await queue.stop({ graceful: true });
      logger.info('worker stopped');
    },
  };
}
