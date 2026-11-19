import { ALERTS_CRON, JOBS, RECONCILE_CRON, sendDrainJob, type JobPayloads } from '@pra/db';
import { handleAlertDeliveries } from './alerts/deliver.ts';
import { handleAlertEvaluation, requestAlertEvaluation } from './alerts/evaluate.ts';
import { listenForAlertTriggers } from './alerts/triggers.ts';
import { withDefaults, type WorkerDeps, type WorkerDepsInput } from './deps.ts';
import { handleGithubComments } from './handlers/github-comment.ts';
import { handleFollowUps } from './handlers/clickup-follow-up.ts';
import { handleGithubEvents } from './handlers/github-event.ts';
import { handleReconcile } from './handlers/reconcile.ts';
import { handleSmoke } from './handlers/smoke.ts';
import { listenForCancels } from './run/cancel.ts';
import { drainQueue } from './run/drain.ts';
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
  // Cancel requests arrive on `pra_change` (S-09-T3); listening starts before recovery, so a
  // request made during it is not missed.
  const cancels = listenForCancels(deps);
  await cancels.ready;
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
  await queue.work<JobPayloads['reconcile']>(JOBS.reconcile, work, () => handleReconcile(deps));
  // pg-boss keeps one schedule per queue; a restart only rewrites it.
  await queue.schedule(JOBS.reconcile, RECONCILE_CRON);
  await queue.work<JobPayloads['run.drain']>(JOBS.runDrain, work, async () => {
    const result = await drainQueue(deps);
    if (result.started.length || result.resumed.length) logger.info(result, 'queued runs started');
  });
  // Every minute: a budget that resets at local midnight and a lost wake-up start runs anyway.
  await queue.schedule(JOBS.runDrain, '* * * * *', {});
  await sendDrainJob(queue);
  // Alerts (S-18): evaluated after run changes and every minute; each new one is delivered once.
  await queue.work<JobPayloads['alerts.evaluate']>(JOBS.alertsEvaluate, work, () =>
    handleAlertEvaluation(deps),
  );
  await queue.work<JobPayloads['alerts.deliver']>(JOBS.alertsDeliver, work, (jobs) =>
    handleAlertDeliveries(deps, jobs),
  );
  await queue.schedule(JOBS.alertsEvaluate, ALERTS_CRON, {});
  const alertTriggers = listenForAlertTriggers(deps);
  await alertTriggers.ready;
  await requestAlertEvaluation(queue);
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
      await cancels.close();
      await alertTriggers.close();
      await queue.stop({ graceful: true });
      logger.info('worker stopped');
    },
  };
}
