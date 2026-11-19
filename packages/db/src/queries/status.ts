// S-10: today's spend in the configured time zone and the agent queue (`run_waits`).
import { sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { spendSince } from './pr-views.ts';

/** Local midnight of `now`'s day in `timeZone`, computed by Postgres. */
export async function startOfLocalDay(db: Executor, timeZone: string, now: Date): Promise<Date> {
  const result = await db.execute<{ since: Date | string }>(
    sql`select (date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timeZone}) at time zone ${timeZone}) as since`,
  );
  return new Date(result.rows[0]!.since);
}

export type SpentToday = { spentUsd: number; since: Date };

/**
 * Cost of every agent session created since local midnight in `timeZone` (OQ9): today's spend,
 * the number the daily budget is checked against.
 */
export async function spentToday(
  db: Executor,
  { timeZone, now = new Date() }: { timeZone: string; now?: Date },
): Promise<SpentToday> {
  const since = await startOfLocalDay(db, timeZone, now);
  return { spentUsd: await spendSince(db, since), since };
}
