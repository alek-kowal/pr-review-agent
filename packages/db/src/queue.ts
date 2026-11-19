import { PgBoss, type ConstructorOptions, type Job, type SendOptions } from 'pg-boss';

/** pg-boss keeps its tables in this schema, next to the Drizzle tables. */
export const QUEUE_SCHEMA = 'pgboss';

/** Job (queue) names. Slices add theirs here: `github.event`, `run.stage`, `github.comment`. */
export const JOBS = {
  smoke: 'smoke',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** The data each job carries. Every name in `JOBS` has an entry. */
export interface JobPayloads {
  smoke: { note: string };
}

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
    for (const name of Object.values(JOBS)) await boss.createQueue(name);
    if (failure) throw failure;
    return { schemaVersion: await boss.schemaVersion() };
  } finally {
    await boss.stop({ graceful: false });
  }
}
