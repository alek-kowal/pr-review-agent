// What Settings → Integrations reports (S-20-T6): webhook deliveries and the last ClickUp call.
import { and, desc, gte, inArray, isNotNull, sql } from 'drizzle-orm';
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
    .orderBy(desc(githubEvents.receivedAt))
    .limit(1);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(githubEvents)
    .where(gte(githubEvents.receivedAt, since));
  return { last: last ?? null, count: row?.count ?? 0 };
}

/** The newest finished attempt of a stage across all runs (e.g. `task`, which calls ClickUp). */
export async function lastFinishedStage(
  db: Executor,
  stage: string,
): Promise<StageExecution | null> {
  const [row] = await db
    .select()
    .from(stageExecutions)
    .where(
      and(
        sql`${stageExecutions.stage} = ${stage}`,
        inArray(stageExecutions.status, ['succeeded', 'failed']),
        isNotNull(stageExecutions.finishedAt),
      ),
    )
    .orderBy(desc(stageExecutions.finishedAt))
    .limit(1);
  return row ?? null;
}
