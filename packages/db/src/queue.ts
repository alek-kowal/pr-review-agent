import { createHash } from 'node:crypto';
import {
  PgBoss,
  type ConstructorOptions,
  type Job,
  type Queue as QueueDefinition,
  type SendOptions,
} from 'pg-boss';

/** pg-boss keeps its tables in this schema, next to the Drizzle tables. */
export const QUEUE_SCHEMA = 'pgboss';

/** Job (queue) names. Each name needs an entry in `JobPayloads`. */
export const JOBS = {
  smoke: 'smoke',
  /** One stored GitHub webhook delivery (`github_events` row) to process. */
  githubEvent: 'github.event',
  /** One stage of one run; keyed `<runId>:<stage>`. */
  runStage: 'run.stage',
  /** The after-round GitHub comment of one run; keyed `<runId>`. */
  githubComment: 'github.comment',
  /** ClickUp follow-up tasks of one Defer to ClickUp decision batch; keyed `<batchId>`. */
  clickupFollowUp: 'clickup.follow-up',
  /** The reconcile poll over every connected repository (cron `RECONCILE_CRON`). */
  reconcile: 'reconcile',
  /** Starts queued runs that may start now, oldest first, and refreshes why the others wait. */
  runDrain: 'run.drain',
  /** Reruns a patch's reproductions after an edit or revert, no model spend; keyed `<patchId>`. */
  patchCheck: 'patch.check',
  /** Pushes a ready patch to the PR branch (S-14-T2); keyed `<patchId>`. */
  patchPush: 'patch.push',
  /** Re-evaluates every alert (S-18-T3): after run changes, and every minute for the budget. */
  alertsEvaluate: 'alerts.evaluate',
  /** The ClickUp comment of one new alert (S-18-T4); keyed `<alertId>`. */
  alertsDeliver: 'alerts.deliver',
} as const;

/** Every minute: the daily budget, and its alerts clearing at local midnight. */
export const ALERTS_CRON = '* * * * *';

/** Every 10 minutes (OQ18): the poll that corrects what webhooks missed (S-03-T14). */
export const RECONCILE_CRON = '*/10 * * * *';

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** The data each job carries. Every name in `JOBS` has an entry. */
export interface JobPayloads {
  smoke: { note: string };
  'github.event': { eventId: number };
  'run.stage': { runId: number; stage: string };
  'github.comment': { runId: number };
  'clickup.follow-up': { batchId: number };
  reconcile: Record<string, never>;
  'run.drain': Record<string, never>;
  'patch.check': { patchId: number };
  /** `signedBy`: the Team member who signed the push; null when level 5 autofix pushes. */
  'patch.push': { patchId: number; signedBy: string | null };
  'alerts.evaluate': Record<string, never>;
  'alerts.deliver': { alertId: number };
}

type QueueSettings = Omit<QueueDefinition, 'name'>;

/** Longest a stage may run (`LevelSettingsPatchSchema` allows 240 minutes) plus a margin. */
const STAGE_JOB_EXPIRY_SECONDS = 5 * 60 * 60;

/**
 * Per-queue settings `migrateQueue` creates (and updates) the queues with. `exclusive` allows one
 * queued or active job per `singletonKey`, so a second send for the same run and stage is
 * dropped. pg-boss's default expiry (15 minutes) would retry a stage that is still running.
 * pg-boss retries twice at once by default; the comment waits instead (1, 2, 4, 8, 16 minutes),
 * so a GitHub outage or a secondary rate limit does not drop it.
 */
export const QUEUE_SETTINGS: Partial<Record<JobName, QueueSettings>> = {
  // Nothing retries a stage by itself (S-09-T1): a failed stage waits for Retry by a person.
  'run.stage': { policy: 'exclusive', expireInSeconds: STAGE_JOB_EXPIRY_SECONDS, retryLimit: 0 },
  'github.comment': { policy: 'exclusive', retryLimit: 5, retryDelay: 60, retryBackoff: true },
  'clickup.follow-up': { policy: 'exclusive', retryLimit: 5, retryDelay: 60, retryBackoff: true },
  // A failed poll is not retried: the next one comes 10 minutes later.
  reconcile: { retryLimit: 0 },
  // One drain runs at a time and one more waits: wakes during a drain are merged into the next.
  'run.drain': { policy: 'stately', retryLimit: 1 },
  // One check per patch at a time and one more waits: edits during a check queue the next one.
  'patch.check': { policy: 'stately', retryLimit: 1 },
  // One push per patch at a time. A retry rebuilds the same commit, so it never adds a second.
  'patch.push': { policy: 'exclusive', retryLimit: 2, retryDelay: 30 },
  // Like the drain: requests during an evaluation merge into the next one.
  'alerts.evaluate': { policy: 'stately', retryLimit: 1 },
  'alerts.deliver': { policy: 'exclusive', retryLimit: 5, retryDelay: 30, retryBackoff: true },
};

/** Queues the push of one patch; a second send while one is queued or running is dropped. */
export function sendPushJob(
  queue: Queue,
  patchId: number,
  signedBy: string | null,
): Promise<string | null> {
  return sendJob(queue, JOBS.patchPush, { patchId, signedBy }, { singletonKey: `${patchId}` });
}

/** Wakes the queue drainer (after a status change, a freed slot, and every minute). */
export function sendDrainJob(queue: Queue): Promise<string | null> {
  return sendJob(queue, JOBS.runDrain, {});
}

/** A follow-up job waits this long, so the decision's Undo (offered for 10 s) creates no task. */
export const FOLLOW_UP_DELAY_SECONDS = 15;

/**
 * A job id derived from `key` (UUID-shaped hash). pg-boss inserts jobs with `on conflict do
 * nothing`, so a second send with the same id is a no-op while the first job row exists.
 */
export function stableJobId(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The `github.event` job id of one delivery: the api and the worker's resend agree on it. */
export const githubEventJobId = (deliveryId: string): string =>
  stableJobId(`${JOBS.githubEvent}:${deliveryId}`);

export type Queue = PgBoss;
/** A job as a handler receives it. */
export type QueueJob<N extends JobName> = Job<JobPayloads[N]>;
export type QueueOptions = Omit<ConstructorOptions, 'connectionString' | 'schema' | 'migrate'>;

/**
 * A pg-boss instance in schema `pgboss`. It never installs or migrates its schema (`migrate:
 * false`): `pnpm db:migrate` does that, so `start()` fails on a database that was not migrated.
 * Callers attach an `error` listener and call `start()` and `stop()`.
 */
export function createQueue(url: string, options: QueueOptions = {}): Queue {
  return new PgBoss({ ...options, connectionString: url, schema: QUEUE_SCHEMA, migrate: false });
}

/** Sends a job with the payload type its name requires. */
export function sendJob<N extends JobName>(
  queue: Queue,
  name: N,
  data: JobPayloads[N],
  options?: SendOptions,
): Promise<string | null> {
  return queue.send(name, data, options);
}

/**
 * Installs or upgrades the pg-boss schema and creates every queue in `JOBS`. Part of
 * `migrateDatabase`; nothing else installs pg-boss.
 */
export async function migrateQueue(url: string): Promise<{ schemaVersion: number | null }> {
  const boss = new PgBoss({
    connectionString: url,
    schema: QUEUE_SCHEMA,
    migrate: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
    max: 2,
  });
  let failure: unknown;
  boss.on('error', (error) => (failure ??= error));
  await boss.start();
  try {
    for (const name of Object.values(JOBS)) {
      await boss.createQueue(name, QUEUE_SETTINGS[name] ?? {});
      // `createQueue` leaves an existing queue as it was; later settings reach it here. The
      // policy cannot change after creation.
      const settings = { ...QUEUE_SETTINGS[name] };
      delete settings.policy;
      if (Object.keys(settings).length) await boss.updateQueue(name, settings);
    }
    if (failure) throw failure;
    return { schemaVersion: await boss.schemaVersion() };
  } finally {
    await boss.stop({ graceful: false });
  }
}
