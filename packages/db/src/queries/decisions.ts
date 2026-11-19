import { HAND, usuallyDecidedBy, type Decision, type UsualDecider } from '@pra/core';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Executor } from '../client.ts';
import { implementerRequests } from '../schema/patches.ts';
import { pullRequests } from '../schema/repositories.ts';
import { ACTIVE_RUN_STATUSES, findings, runs } from '../schema/runs.ts';
import {
  decisionBatches,
  findingDecisions,
  teamMembers,
  type FollowUpStatus,
} from '../schema/team.ts';
import { recordStateChange, recordTimelineEntry } from './timeline.ts';

export type DecisionBatch = typeof decisionBatches.$inferSelect;

/** Something that can open a transaction: the client, or a transaction (then it is a savepoint). */
export type Transactor = Pick<Db, 'transaction'>;

/** A finding's current decision: its latest batch that is not undone, with the signer's name. */
export type CurrentDecision = {
  findingId: number;
  batchId: number;
  decision: Decision;
  reason: string | null;
  signedBy: string;
  /** Kept after the signer leaves the team. */
  signerName: string;
  decidedAt: Date;
  /** The PR author when it was decided (S-08-T5); null for decisions stored before that. */
  author: UsualDecider | null;
  /** Defer to ClickUp: the follow-up task (S-06-T5); status null until its job ran. */
  followUp: {
    status: FollowUpStatus | null;
    taskId: string | null;
    url: string | null;
    error: { code: string; params: Record<string, unknown> } | null;
  } | null;
};

/** Current decisions of these findings; a finding without one is missing from the map. */
export async function currentDecisions(
  db: Executor,
  findingIds: readonly number[],
): Promise<Map<number, CurrentDecision>> {
  if (findingIds.length === 0) return new Map();
  const authors = alias(teamMembers, 'authors');
  const rows = await db
    .select({
      findingId: findingDecisions.findingId,
      batchId: decisionBatches.id,
      decision: decisionBatches.decision,
      reason: decisionBatches.reason,
      signedBy: decisionBatches.signedBy,
      signerName: teamMembers.name,
      decidedAt: decisionBatches.createdAt,
      authorLogin: decisionBatches.authorLogin,
      authorMemberId: decisionBatches.authorMemberId,
      authorName: authors.name,
      followUpStatus: findingDecisions.followUpStatus,
      followUpTaskId: findingDecisions.followUpTaskId,
      followUpUrl: findingDecisions.followUpUrl,
      followUpError: findingDecisions.followUpError,
    })
    .from(findingDecisions)
    .innerJoin(decisionBatches, eq(decisionBatches.id, findingDecisions.batchId))
    .innerJoin(teamMembers, eq(teamMembers.id, decisionBatches.signedBy))
    .leftJoin(authors, eq(authors.id, decisionBatches.authorMemberId))
    .where(
      and(inArray(findingDecisions.findingId, [...findingIds]), isNull(decisionBatches.undoneAt)),
    )
    .orderBy(desc(decisionBatches.id));
  // Newest batch first: the first row of each finding is its current decision.
  const current = new Map<number, CurrentDecision>();
  for (const row of rows) {
    if (current.has(row.findingId)) continue;
    const {
      followUpStatus,
      followUpTaskId,
      followUpUrl,
      followUpError,
      authorLogin,
      authorMemberId,
      authorName,
      ...decision
    } = row;
    current.set(row.findingId, {
      ...decision,
      author:
        authorLogin === null
          ? null
          : { login: authorLogin, memberId: authorMemberId, name: authorName },
      followUp:
        decision.decision === 'defer'
          ? {
              status: followUpStatus,
              taskId: followUpTaskId,
              url: followUpUrl,
              error: followUpError,
            }
          : null,
    });
  }
  return current;
}

/** Who usually decides the PR's findings (core `usuallyDecidedBy` over the active Team). */
export async function prAuthor(db: Executor, pullRequestId: number): Promise<UsualDecider> {
  // One after the other: inside a transaction both would share one connection.
  const [pr] = await db
    .select({ authorLogin: pullRequests.authorLogin })
    .from(pullRequests)
    .where(eq(pullRequests.id, pullRequestId));
  if (!pr) throw new Error(`pull request ${pullRequestId} not found`);
  const team = await db.select().from(teamMembers).where(isNull(teamMembers.removedAt));
  return usuallyDecidedBy(pr, team);
}

export type DecideFindingsInput = {
  pullRequestId: number;
  findingIds: readonly number[];
  /** The version of each finding the signer saw, by finding id. */
  expectedVersions: Readonly<Record<number, number>>;
  decision: Decision;
  reason?: string | null;
  /** The signing Team member's id; the caller checks they are active. */
  signedBy: string;
};

/** A finding that moved since the signer saw it, with the decision that moved it. */
export type DecisionConflict = {
  findingId: number;
  expectedVersion: number | null;
  version: number;
  current: CurrentDecision | null;
};

export type DecideFindingsResult =
  | { ok: true; batch: DecisionBatch; versions: Record<number, number> }
  | { ok: false; reason: 'conflict'; conflicts: DecisionConflict[] }
  | { ok: false; reason: 'not_found'; missing: number[] };

/**
 * Decides findings of one PR in one batch, all or nothing (Concurrent edits NFR). Each finding's
 * row is locked and its version compared with the one the signer saw; when any moved, nothing is
 * written and the conflicts name the current decision and its signer. Otherwise it writes one
 * batch and bumps every finding's version.
 */
export async function decideFindings(
  db: Transactor,
  input: DecideFindingsInput,
): Promise<DecideFindingsResult> {
  const ids = [...new Set(input.findingIds)].sort((a, b) => a - b);
  if (ids.length === 0) throw new Error('decideFindings needs at least one finding');

  return db.transaction(async (tx) => {
    // Locked in id order, so two batches over the same findings never deadlock.
    const locked = await tx
      .select({ id: findings.id, version: findings.version })
      .from(findings)
      .where(and(inArray(findings.id, ids), eq(findings.pullRequestId, input.pullRequestId)))
      .orderBy(asc(findings.id))
      .for('update');

    const found = new Set(locked.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) return { ok: false, reason: 'not_found', missing };

    const moved = locked.filter((row) => input.expectedVersions[row.id] !== row.version);
    if (moved.length > 0) {
      const current = await currentDecisions(
        tx,
        moved.map((row) => row.id),
      );
      return {
        ok: false,
        reason: 'conflict',
        conflicts: moved.map((row) => ({
          findingId: row.id,
          expectedVersion: input.expectedVersions[row.id] ?? null,
          version: row.version,
          current: current.get(row.id) ?? null,
        })),
      };
    }

    const author = await prAuthor(tx, input.pullRequestId);
    const [batch] = await tx
      .insert(decisionBatches)
      .values({
        pullRequestId: input.pullRequestId,
        decision: input.decision,
        reason: input.reason ?? null,
        signedBy: input.signedBy,
        // S-08-T5: the author as of now, so the label keeps naming who it was.
        authorLogin: author.login,
        authorMemberId: author.memberId,
      })
      .returning();
    const bumped = await bumpVersions(tx, ids);
    await tx
      .insert(findingDecisions)
      .values(
        bumped.map((row) => ({ findingId: row.id, batchId: batch!.id, version: row.version })),
      );
    // S-03-T5: the signed decision on the Timeline, and the state it leaves the PR in.
    await recordTimelineEntry(tx, {
      pullRequestId: input.pullRequestId,
      actor: { kind: 'member', memberId: input.signedBy },
      kind: 'findings_decided',
      params: { decision: input.decision, count: ids.length, reason: input.reason ?? null },
      at: batch!.createdAt,
      sourceKey: `decision_batch:${batch!.id}`,
    });
    await recordStateChange(
      tx,
      input.pullRequestId,
      { code: 'findings_decided' },
      { at: batch!.createdAt },
    );

    return {
      ok: true,
      batch: batch!,
      versions: Object.fromEntries(bumped.map((row) => [row.id, row.version])),
    };
  });
}

export type UndoDecisionResult =
  | { ok: true; batch: DecisionBatch; versions: Record<number, number> }
  | { ok: false; reason: 'not_found' | 'already_undone' }
  /** A finding of the batch changed after it, for example a later decision. */
  | { ok: false; reason: 'changed_since'; findingIds: number[] }
  /** A queued or running implementer run is fixing a finding of the batch. */
  | { ok: false; reason: 'implementer_active'; status: (typeof ACTIVE_RUN_STATUSES)[number] };

/**
 * Undoes a batch while none of its findings changed since; each finding's decision falls back to
 * its previous batch (or none). Bumps the versions, so a form opened before the undo conflicts.
 */
export async function undoDecisionBatch(
  db: Transactor,
  batchId: number,
  at: Date = new Date(),
): Promise<UndoDecisionResult> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(decisionBatches)
      .where(eq(decisionBatches.id, batchId))
      .for('update');
    if (!batch) return { ok: false, reason: 'not_found' };
    if (batch.undoneAt) return { ok: false, reason: 'already_undone' };

    const rows = await tx
      .select({ id: findings.id, version: findings.version, decidedAt: findingDecisions.version })
      .from(findingDecisions)
      .innerJoin(findings, eq(findings.id, findingDecisions.findingId))
      .where(eq(findingDecisions.batchId, batchId))
      .orderBy(asc(findings.id))
      .for('update', { of: findings });

    const changed = rows.filter((row) => row.version !== row.decidedAt).map((row) => row.id);
    if (changed.length > 0) return { ok: false, reason: 'changed_since', findingIds: changed };

    // A decision `withAgent` started an implementer run on these findings: undone now, the run
    // would keep fixing findings no longer decided Implement and its patch would land anyway.
    const decided = new Set(rows.map((row) => row.id));
    const implementers = await tx
      .select({ status: runs.status, findingIds: implementerRequests.findingIds })
      .from(implementerRequests)
      .innerJoin(runs, eq(runs.id, implementerRequests.runId))
      .where(
        and(
          eq(runs.pullRequestId, batch.pullRequestId),
          inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
        ),
      );
    const fixing = implementers.find((run) => run.findingIds.some((id) => decided.has(id)));
    if (fixing) {
      return {
        ok: false,
        reason: 'implementer_active',
        status: fixing.status as (typeof ACTIVE_RUN_STATUSES)[number],
      };
    }

    const [undone] = await tx
      .update(decisionBatches)
      .set({ undoneAt: at })
      .where(eq(decisionBatches.id, batchId))
      .returning();
    const bumped = await bumpVersions(
      tx,
      rows.map((row) => row.id),
    );
    await recordTimelineEntry(tx, {
      pullRequestId: batch.pullRequestId,
      actor: HAND,
      kind: 'decision_undone',
      params: { decision: batch.decision, count: rows.length },
      at,
      sourceKey: `decision_batch:${batch.id}:undone`,
    });
    await recordStateChange(tx, batch.pullRequestId, { code: 'decision_undone' }, { at });
    return {
      ok: true,
      batch: undone!,
      versions: Object.fromEntries(bumped.map((row) => [row.id, row.version])),
    };
  });
}

export async function getDecisionBatch(
  db: Executor,
  batchId: number,
): Promise<DecisionBatch | null> {
  const [row] = await db.select().from(decisionBatches).where(eq(decisionBatches.id, batchId));
  return row ?? null;
}

/** The batches of a PR, newest first, with their finding ids. */
export async function listDecisionBatches(
  db: Executor,
  pullRequestId: number,
): Promise<(DecisionBatch & { findingIds: number[] })[]> {
  const rows = await db
    .select({
      batch: decisionBatches,
      findingIds: sql<
        number[]
      >`coalesce(array_agg(${findingDecisions.findingId} order by ${findingDecisions.findingId}), '{}')`,
    })
    .from(decisionBatches)
    .leftJoin(findingDecisions, eq(findingDecisions.batchId, decisionBatches.id))
    .where(eq(decisionBatches.pullRequestId, pullRequestId))
    .groupBy(decisionBatches.id)
    .orderBy(desc(decisionBatches.id));
  return rows.map((row) => ({ ...row.batch, findingIds: row.findingIds }));
}

async function bumpVersions(
  tx: Executor,
  ids: number[],
): Promise<{ id: number; version: number }[]> {
  if (ids.length === 0) return [];
  return tx
    .update(findings)
    .set({ version: sql`${findings.version} + 1` })
    .where(inArray(findings.id, ids))
    .returning({ id: findings.id, version: findings.version });
}
