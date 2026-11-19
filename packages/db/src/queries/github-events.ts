import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
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
  db: Db,
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

export async function getGithubEvent(db: Db, id: number): Promise<GithubEvent | null> {
  const [row] = await db.select().from(githubEvents).where(eq(githubEvents.id, id));
  return row ?? null;
}

/** Records the worker's outcome code for an event. */
export async function markGithubEventProcessed(db: Db, id: number, outcome: string): Promise<void> {
  await db
    .update(githubEvents)
    .set({ outcome, processedAt: sql`now()` })
    .where(eq(githubEvents.id, id));
}
