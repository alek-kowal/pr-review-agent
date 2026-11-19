// The ClickUp task a pull request implements (`pr_task_links`, S-06).
import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { prTaskLinks } from '../schema/clickup.ts';

export type PrTaskLink = typeof prTaskLinks.$inferSelect;
export type NewPrTaskLink = Omit<typeof prTaskLinks.$inferInsert, 'id' | 'createdAt'>;

export async function getTaskLink(db: Executor, pullRequestId: number): Promise<PrTaskLink | null> {
  const [row] = await db
    .select()
    .from(prTaskLinks)
    .where(eq(prTaskLinks.pullRequestId, pullRequestId));
  return row ?? null;
}

/** Stores the PR's link, replacing an older one (one link per PR). */
export async function upsertTaskLink(db: Executor, link: NewPrTaskLink): Promise<PrTaskLink> {
  const [row] = await db
    .insert(prTaskLinks)
    .values(link)
    .onConflictDoUpdate({
      target: prTaskLinks.pullRequestId,
      set: {
        taskId: link.taskId,
        url: link.url,
        name: link.name,
        how: link.how,
        linkedBy: link.linkedBy,
        linkedByMemberId: link.linkedByMemberId ?? null,
        createdAt: new Date(),
      },
    })
    .returning();
  return row!;
}
