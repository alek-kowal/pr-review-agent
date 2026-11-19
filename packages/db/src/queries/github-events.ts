import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { githubEvents } from '../schema/repositories.ts';

export type GithubEvent = typeof githubEvents.$inferSelect;
export type NewGithubEvent = Pick<
  typeof githubEvents.$inferInsert,
  'deliveryId' | 'event' | 'action' | 'repositoryFullName' | 'prNumber' | 'blobKey'
>;

/**
 * Stores a delivery once. A redelivery (same `X-GitHub-Delivery` id) writes nothing and returns
 * the stored row with `created: false`.
 */
export async function recordGithubEvent(
  db: Executor,
  event: NewGithubEvent,
): Promise<{ event: GithubEvent; created: boolean }> {
  const [inserted] = await db
    .insert(githubEvents)
    .values(event)
    .onConflictDoNothing({ target: githubEvents.deliveryId })
    .returning();
  if (inserted) return { event: inserted, created: true };
  const [existing] = await db
    .select()
    .from(githubEvents)
    .where(eq(githubEvents.deliveryId, event.deliveryId));
  return { event: existing!, created: false };
}

export async function getGithubEvent(db: Executor, id: number): Promise<GithubEvent | null> {
  const [row] = await db.select().from(githubEvents).where(eq(githubEvents.id, id));
  return row ?? null;
}

/**
 * Records an outcome before the event is fully processed, in the transaction that made it true
 * (`round_started` with the run), so a retried job of the event does not repeat it.
 */
export async function setGithubEventOutcome(
  db: Executor,
  id: number,
  outcome: string,
): Promise<void> {
  await db.update(githubEvents).set({ outcome }).where(eq(githubEvents.id, id));
}

/** Records the worker's outcome code for an event. */
export async function markGithubEventProcessed(
  db: Executor,
  id: number,
  outcome: string,
): Promise<void> {
  await db
    .update(githubEvents)
    .set({ outcome, processedAt: sql`now()` })
    .where(eq(githubEvents.id, id));
}

/**
 * Events received between `from` and `to` that no job processed yet, oldest first: the api may
 * have stored the row and then failed to send its job.
 */
export async function unprocessedGithubEvents(
  db: Executor,
  { from, to }: { from: Date; to: Date },
  limit = 500,
): Promise<Pick<GithubEvent, 'id' | 'deliveryId'>[]> {
  return db
    .select({ id: githubEvents.id, deliveryId: githubEvents.deliveryId })
    .from(githubEvents)
    .where(
      and(
        isNull(githubEvents.processedAt),
        gt(githubEvents.receivedAt, from),
        lt(githubEvents.receivedAt, to),
      ),
    )
    .orderBy(asc(githubEvents.id))
    .limit(limit);
}
