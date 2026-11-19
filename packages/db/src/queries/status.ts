// S-10: today's spend in the configured time zone and the agent queue (`run_waits`).
import type { Reason } from '@pra/core';
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests } from '../schema/repositories.ts';
import { runs } from '../schema/runs.ts';
import { runWaits } from '../schema/status.ts';
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

/**
 * Serialises every start decision until the transaction ends (Postgres advisory transaction
 * lock), so concurrent starts never take more slots than there are.
 */
export async function lockAgentQueue(tx: Executor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pra.agent_queue'))`);
}

export type QueuedRunRef = { runId: number; prNumber: number; createdAt: Date };

const runRef = {
  runId: runs.id,
  prNumber: pullRequests.number,
  createdAt: runs.createdAt,
};

/**
 * Runs that hold an agent slot, oldest first: every running run, and queued runs a gate let
 * through (they are starting).
 */
export async function slotHolders(db: Executor): Promise<QueuedRunRef[]> {
  return db
    .select(runRef)
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .leftJoin(runWaits, eq(runWaits.runId, runs.id))
    .where(
      or(
        eq(runs.status, 'running'),
        and(eq(runs.status, 'queued'), isNotNull(runWaits.admittedAt)),
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/** Queued runs no gate let through yet, oldest first: they wait for their start. */
export async function runsWaitingToStart(db: Executor): Promise<QueuedRunRef[]> {
  return db
    .select(runRef)
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .leftJoin(runWaits, eq(runWaits.runId, runs.id))
    .where(and(eq(runs.status, 'queued'), isNull(runWaits.admittedAt)))
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/** How many queued runs older than this one wait for their start (they get a slot first). */
export async function queuedAheadOf(
  db: Executor,
  run: { id: number; createdAt: Date },
): Promise<number> {
  const waiting = await runsWaitingToStart(db);
  return waiting.filter(
    (other) =>
      other.runId !== run.id &&
      (other.createdAt < run.createdAt ||
        (other.createdAt.getTime() === run.createdAt.getTime() && other.runId < run.id)),
  ).length;
}

/** Started (or let-through) runs that wait before an agent session, oldest first. */
export async function runsWaitingForSession(db: Executor): Promise<QueuedRunRef[]> {
  return db
    .select(runRef)
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .innerJoin(runWaits, eq(runWaits.runId, runs.id))
    .where(
      and(
        isNotNull(runWaits.reason),
        or(
          eq(runs.status, 'running'),
          and(eq(runs.status, 'queued'), isNotNull(runWaits.admittedAt)),
        ),
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/** The run takes its slot: let through, waiting for nothing. */
export async function admitRun(db: Executor, runId: number): Promise<void> {
  await db
    .insert(runWaits)
    .values({ runId, admittedAt: sql`now()`, reason: null, waitingSince: null })
    .onConflictDoUpdate({
      target: runWaits.runId,
      set: {
        admittedAt: sql`coalesce(${runWaits.admittedAt}, now())`,
        reason: null,
        waitingSince: null,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Stores why the run waits. `start`: it waits for its start and gives up a slot it was let
 * through for; `session`: a started run waits before an agent session and keeps its slot. A row
 * that already says the same is left as it is (no change notification).
 */
export async function setRunWait(
  db: Executor,
  runId: number,
  reason: Reason,
  waitsFor: 'start' | 'session',
): Promise<void> {
  const admittedAt = waitsFor === 'start' ? sql`null` : sql`${runWaits.admittedAt}`;
  await db
    .insert(runWaits)
    .values({ runId, reason, waitingSince: sql`now()` })
    .onConflictDoUpdate({
      target: runWaits.runId,
      set: {
        admittedAt,
        reason,
        waitingSince: sql`coalesce(${runWaits.waitingSince}, now())`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${runWaits.reason} is distinct from excluded.reason or ${runWaits.admittedAt} is distinct from ${admittedAt}`,
    });
}

/** The run no longer waits (it keeps its slot). */
export async function clearRunWait(db: Executor, runId: number): Promise<void> {
  await db
    .update(runWaits)
    .set({ reason: null, waitingSince: null, updatedAt: sql`now()` })
    .where(and(eq(runWaits.runId, runId), isNotNull(runWaits.reason)));
}

export type RunWait = typeof runWaits.$inferSelect;

/** The queue rows of these runs, by run id. */
export async function runWaitsOf(db: Executor, runIds: number[]): Promise<Map<number, RunWait>> {
  if (runIds.length === 0) return new Map();
  const rows = await db.select().from(runWaits).where(inArray(runWaits.runId, runIds));
  return new Map(rows.map((row) => [row.runId, row]));
}
