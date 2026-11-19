import { JOBS, type JobPayloads } from '@pra/db';
import { withDefaults, type WorkerDeps, type WorkerDepsInput } from './deps.ts';
import { handleGithubComments } from './handlers/github-comment.ts';
import { handleFollowUps } from './handlers/clickup-follow-up.ts';
import { handleGithubEvents } from './handlers/github-event.ts';
import { handleSmoke } from './handlers/smoke.ts';
import { handleRunStages } from './run/execute-stage.ts';
import { recoverRuns, resendLostJobs } from './run/recover.ts';

export type { WorkerDeps, WorkerDepsInput };

export type WorkerOptions = {
  /** How often each job handler polls for new jobs; pg-boss's default (and minimum 0.5) applies. */
  pollingIntervalSeconds?: number;
  /** How often jobs lost by a failed send are sent again (default 5 minutes). */
  resendIntervalMs?: number;
};

const RESEND_INTERVAL_MS = 5 * 60_000;

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
  await recoverRuns(deps);
  await queue.work<JobPayloads['smoke']>(JOBS.smoke, work, (jobs) => handleSmoke(deps, jobs));
  await queue.work<JobPayloads['github.event']>(JOBS.githubEvent, work, (jobs) =>
    handleGithubEvents(deps, jobs),
  );
  await queue.work<JobPayloads['run.stage']>(JOBS.runStage, work, (jobs) =>
    handleRunStages(deps, jobs),
  );
  await queue.work<JobPayloads['github.comment']>(JOBS.githubComment, work, (jobs) =>
    handleGithubComments(deps, jobs),
  );
  await queue.work<JobPayloads['clickup.follow-up']>(JOBS.clickupFollowUp, work, (jobs) =>
    handleFollowUps(deps, jobs),
  );
  logger.info({ jobs: Object.values(JOBS) }, 'worker started');

  // A send that failed after its row was committed (the api's event job, a next stage job) is
  // repaired here, not only at the next start.
  let resending = false;
  const resend = setInterval(() => {
    if (resending) return;
    resending = true;
    resendLostJobs(deps)
      .then((result) => {
        if (result.resent.length || result.events.length || result.followUps.length) {
          logger.info(result, 'lost jobs sent');
        }
      })
      .catch((error: unknown) => logger.warn({ err: error }, 'resending lost jobs failed'))
      .finally(() => (resending = false));
  }, options.resendIntervalMs ?? RESEND_INTERVAL_MS);

  return {
    async stop() {
      clearInterval(resend);
      await queue.stop({ graceful: true });
      logger.info('worker stopped');
    },
  };
}
