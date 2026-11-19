import { schema, type QueueJob } from '@pra/db';
import type { WorkerDeps } from '../worker.ts';

/** Proves the queue end to end: each `smoke` job writes one `smoke` row. */
export async function handleSmoke(
  { db, logger }: WorkerDeps,
  jobs: QueueJob<'smoke'>[],
): Promise<void> {
  for (const job of jobs) {
    await db.insert(schema.smoke).values({ note: job.data.note });
    logger.info({ job: { name: job.name, id: job.id } }, 'handled smoke job');
  }
}
