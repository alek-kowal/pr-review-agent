// What Settings → Integrations reports (S-20-T6): webhook deliveries and the last ClickUp call.
import { and, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { githubEvents } from '../schema/repositories.ts';
import { stageExecutions } from '../schema/runs.ts';
import type { GithubEvent } from './github-events.ts';
import type { StageExecution } from './runs.ts';

/** The newest stored delivery, and how many arrived since `since`. */
export async function githubDeliveryStats(
  db: Executor,
  since: Date,
): Promise<{ last: GithubEvent | null; count: number }> {
  const [last] = await db
    .select()
    .from(githubEvents)
    .orderBy(desc(githubEvents.receivedAt), desc(githubEvents.id))
    .limit(1);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(githubEvents)
    .where(gte(githubEvents.receivedAt, since));
  return { last: last ?? null, count: row?.count ?? 0 };
}

/**
 * The newest Task stage attempt that called ClickUp: a failed one, or a succeeded one whose output
 * is not `not_configured` (then no call was made). Null when ClickUp was never called.
 */
export async function lastClickUpCall(db: Executor): Promise<StageExecution | null> {
  const [row] = await db
    .select()
    .from(stageExecutions)
    .where(
      and(
        eq(stageExecutions.stage, 'task'),
        isNotNull(stageExecutions.finishedAt),
        or(
          eq(stageExecutions.status, 'failed'),
          and(
            eq(stageExecutions.status, 'succeeded'),
            sql`coalesce(${stageExecutions.output}->>'status', '') <> 'not_configured'`,
          ),
        ),
      ),
    )
    .orderBy(desc(stageExecutions.finishedAt), desc(stageExecutions.id))
    .limit(1);
  return row ?? null;
}
