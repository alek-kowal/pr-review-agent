// Source rows for pilot metrics 2 and 5 (S-19-T1): when a PR was first ready, closed and
// merged, and every move of its head. The PR state log is `recordStateChange` (timeline.ts).
import { isBaseMerge, type CommitInfo } from '@pra/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { headChanges } from '../schema/metrics.ts';
import { githubEvents, pullRequests } from '../schema/repositories.ts';

export type HeadChange = typeof headChanges.$inferSelect;

/** Sets `ready_at` the first time the PR is ready for review; later calls change nothing. */
export async function recordPrReady(db: Executor, pullRequestId: number, at: Date): Promise<void> {
  await db
    .update(pullRequests)
    .set({ readyAt: at })
    .where(and(eq(pullRequests.id, pullRequestId), isNull(pullRequests.readyAt)));
}

/** Records a close; `merged` adds the merge time and GitHub's merge commit. */
export async function recordPrClosed(
  db: Executor,
  pullRequestId: number,
  closed: { at: Date; merged: { at: Date; sha: string | null } | null },
): Promise<void> {
  await db
    .update(pullRequests)
    .set({
      closedAt: closed.at,
      mergedAt: closed.merged?.at ?? null,
      mergeSha: closed.merged?.sha ?? null,
    })
    .where(eq(pullRequests.id, pullRequestId));
}

export type HeadChangeInput = {
  pullRequestId: number;
  /** The event it comes from; the same event never writes twice. */
  githubEventId: number | null;
  beforeSha: string;
  afterSha: string;
  pusher: string | null;
  byBot: boolean;
  /** The base SHA at the change, and the new head commit, to tell a base merge apart. */
  baseSha: string;
  commit: CommitInfo | null;
  at: Date;
};

/** Logs one head move, marking base merges (core `isBaseMerge`). Null when already logged. */
export async function recordHeadChange(
  db: Executor,
  change: HeadChangeInput,
): Promise<HeadChange | null> {
  const [row] = await db
    .insert(headChanges)
    .values({
      pullRequestId: change.pullRequestId,
      githubEventId: change.githubEventId,
      beforeSha: change.beforeSha,
      afterSha: change.afterSha,
      pusher: change.pusher,
      byBot: change.byBot,
      isBaseMerge: isBaseMerge(change),
      at: change.at,
    })
    .onConflictDoNothing({ target: headChanges.githubEventId })
    .returning();
  return row ?? null;
}

/** The PR's head moves, oldest first. */
export function headChangesOf(db: Executor, pullRequestId: number): Promise<HeadChange[]> {
  return db
    .select()
    .from(headChanges)
    .where(eq(headChanges.pullRequestId, pullRequestId))
    .orderBy(asc(headChanges.at), asc(headChanges.id));
}

/** Whether the event already wrote its head change (the backfill skips those). */
export async function hasHeadChangeFor(db: Executor, githubEventId: number): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(headChanges)
    .where(eq(headChanges.githubEventId, githubEventId))
    .limit(1);
  return Boolean(row);
}

/** Every stored `pull_request` event, oldest first (the metric backfill replays them). */
export function pullRequestEventsInOrder(db: Executor) {
  return db
    .select()
    .from(githubEvents)
    .where(eq(githubEvents.event, 'pull_request'))
    .orderBy(asc(githubEvents.receivedAt), asc(githubEvents.id));
}
