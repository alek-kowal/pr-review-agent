// S-03-T5: the PR timeline and the PR state-change log. Every writer goes through
// `recordTimelineEntry` and `recordStateChange`; later slices add their entries the same way.
import { laneOf, prState, type Actor } from '@pra/core';
import { asc, desc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests } from '../schema/repositories.ts';
import { teamMembers } from '../schema/team.ts';
import { prStateChanges, timelineEntries } from '../schema/timeline.ts';
import type { Transactor } from './decisions.ts';
import { loadPrStateInput } from './pr-state.ts';

export type TimelineEntry = typeof timelineEntries.$inferSelect;
export type PrStateChange = typeof prStateChanges.$inferSelect;

export type NewTimelineEntry = {
  pullRequestId: number;
  actor: Actor;
  /** For example `pr_ready`, `round_started`, `round_finished`, `findings_decided`. */
  kind: string;
  params?: Record<string, unknown>;
  runId?: number | null;
  costUsd?: number | null;
  /** When it happened; defaults to now. */
  at?: Date;
  /** Unique per PR: the event, run or batch the entry comes from. */
  sourceKey: string;
};

/** Adds one entry; a second write with the same `sourceKey` does nothing. Returns the new row. */
export async function recordTimelineEntry(
  db: Executor,
  entry: NewTimelineEntry,
): Promise<TimelineEntry | null> {
  const [row] = await db
    .insert(timelineEntries)
    .values({
      pullRequestId: entry.pullRequestId,
      actor: entry.actor.kind,
      memberId: entry.actor.kind === 'member' ? entry.actor.memberId : null,
      kind: entry.kind,
      params: entry.params ?? {},
      runId: entry.runId ?? null,
      costUsd: entry.costUsd ?? null,
      ...(entry.at ? { at: entry.at } : {}),
      sourceKey: entry.sourceKey,
    })
    .onConflictDoNothing({ target: [timelineEntries.pullRequestId, timelineEntries.sourceKey] })
    .returning();
  return row ?? null;
}

/**
 * Computes the PR's state with core `prState` and logs it when it differs from the last logged
 * state. The PR row is locked, so two writers never log the same change twice. Returns the new
 * row, or null when the state did not change.
 */
export async function recordStateChange(
  db: Transactor,
  pullRequestId: number,
  reason: { code: string; params?: Record<string, unknown> },
  options: { at?: Date } = {},
): Promise<PrStateChange | null> {
  return db.transaction(async (tx) => {
    const [pr] = await tx
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, pullRequestId))
      .for('update');
    if (!pr) return null;
    const load = await loadPrStateInput(tx, pullRequestId);
    if (!load) return null;
    const state = prState(load.input);
    const [last] = await tx
      .select({ state: prStateChanges.state })
      .from(prStateChanges)
      .where(eq(prStateChanges.pullRequestId, pullRequestId))
      .orderBy(desc(prStateChanges.at), desc(prStateChanges.id))
      .limit(1);
    if (last?.state === state) return null;
    const [row] = await tx
      .insert(prStateChanges)
      .values({
        pullRequestId,
        state,
        lane: laneOf(state),
        reason: { code: reason.code, params: reason.params ?? {} },
        headSha: pr.headSha,
        ...(options.at ? { at: options.at } : {}),
      })
      .returning();
    return row!;
  });
}

export type TimelineRow = TimelineEntry & { memberName: string | null };

/** The PR's timeline, oldest first, with the signing member's name. */
export async function timelineOf(db: Executor, pullRequestId: number): Promise<TimelineRow[]> {
  const rows = await db
    .select({ entry: timelineEntries, memberName: teamMembers.name })
    .from(timelineEntries)
    .leftJoin(teamMembers, eq(teamMembers.id, timelineEntries.memberId))
    .where(eq(timelineEntries.pullRequestId, pullRequestId))
    .orderBy(asc(timelineEntries.at), asc(timelineEntries.id));
  return rows.map((row) => ({ ...row.entry, memberName: row.memberName }));
}

/** The PR's logged states, oldest first. */
export async function stateChangesOf(
  db: Executor,
  pullRequestId: number,
): Promise<PrStateChange[]> {
  return db
    .select()
    .from(prStateChanges)
    .where(eq(prStateChanges.pullRequestId, pullRequestId))
    .orderBy(asc(prStateChanges.at), asc(prStateChanges.id));
}
