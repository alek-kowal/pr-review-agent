// S-08-T4: signed opinions on findings, saved together as one signed review (FR-037, FR-038).
import { matchFindings } from '@pra/core';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests } from '../schema/repositories.ts';
import { opinions, reviews, type OpinionValue } from '../schema/reviews.ts';
import { findings, runs } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';
import type { Transactor } from './decisions.ts';
import type { Run } from './runs.ts';
import { recordStateChange, recordTimelineEntry } from './timeline.ts';

export type Review = typeof reviews.$inferSelect;

/**
 * Locks the PR row first. A write that adds rows pointing at the PR (key share) and then logs the
 * state change (`recordStateChange`, which locks the PR row for update) would otherwise deadlock
 * with a concurrent writer doing the same; with this lock they take turns.
 */
export async function lockPullRequestRow(db: Executor, pullRequestId: number): Promise<void> {
  await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(eq(pullRequests.id, pullRequestId))
    .for('update');
}

/** An opinion with its signer's name (kept after they leave the team). */
export type OpinionRow = {
  id: number;
  findingId: number;
  signedBy: string;
  signerName: string;
  value: OpinionValue;
  comment: string | null;
  reviewId: number | null;
  fromRound: number;
  carriedFromId: number | null;
  createdAt: Date;
};

const opinionColumns = {
  id: opinions.id,
  findingId: opinions.findingId,
  signedBy: opinions.signedBy,
  signerName: teamMembers.name,
  value: opinions.value,
  comment: opinions.comment,
  reviewId: opinions.reviewId,
  fromRound: opinions.fromRound,
  carriedFromId: opinions.carriedFromId,
  createdAt: opinions.createdAt,
};

/** The opinions of these findings by finding id, oldest first; a finding without any is missing. */
export async function opinionsOf(
  db: Executor,
  findingIds: readonly number[],
): Promise<Map<number, OpinionRow[]>> {
  if (findingIds.length === 0) return new Map();
  const rows = await db
    .select(opinionColumns)
    .from(opinions)
    .innerJoin(teamMembers, eq(teamMembers.id, opinions.signedBy))
    .where(inArray(opinions.findingId, [...findingIds]))
    .orderBy(asc(opinions.createdAt), asc(opinions.id));
  const byFinding = new Map<number, OpinionRow[]>();
  for (const row of rows)
    byFinding.set(row.findingId, [...(byFinding.get(row.findingId) ?? []), row]);
  return byFinding;
}

/** A review with its signer's name. */
export type ReviewRow = Review & { signerName: string };

/** The PR's signed reviews, newest first. */
export async function reviewsOf(db: Executor, pullRequestId: number): Promise<ReviewRow[]> {
  const rows = await db
    .select({ review: reviews, signerName: teamMembers.name })
    .from(reviews)
    .innerJoin(teamMembers, eq(teamMembers.id, reviews.signedBy))
    .where(eq(reviews.pullRequestId, pullRequestId))
    .orderBy(desc(reviews.id));
  return rows.map((row) => ({ ...row.review, signerName: row.signerName }));
}

export async function getReview(db: Executor, id: number): Promise<ReviewRow | null> {
  const [row] = await db
    .select({ review: reviews, signerName: teamMembers.name })
    .from(reviews)
    .innerJoin(teamMembers, eq(teamMembers.id, reviews.signedBy))
    .where(eq(reviews.id, id));
  return row ? { ...row.review, signerName: row.signerName } : null;
}

/**
 * S-08-T7 (FR-043): when a full review (round 1 of its chain) completes, copies each opinion on the
 * PR's previous full review's findings to the matching new finding (core `matchFindings`), marked
 * with its original round and `carried_from_id`. Originals stay; a signer's own opinion already on
 * the new finding wins; running it again adds nothing. Returns how many it copied.
 */
export async function carryOpinions(db: Executor, run: Run): Promise<number> {
  if (run.kind !== 'round' || (run.roundNo ?? 1) !== 1) return 0;
  const [previous] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.pullRequestId, run.pullRequestId),
        eq(runs.kind, 'round'),
        eq(runs.status, 'completed'),
        sql`coalesce(${runs.roundNo}, 1) = 1`,
        lt(runs.id, run.id),
      ),
    )
    .orderBy(desc(runs.id))
    .limit(1);
  if (!previous) return 0;

  const earlier = await db.select().from(findings).where(eq(findings.runId, previous.id));
  const later = await db.select().from(findings).where(eq(findings.runId, run.id));
  const byFinding = await opinionsOf(
    db,
    earlier.map((f) => f.id),
  );
  const pairs = matchFindings(
    earlier.filter((f) => byFinding.has(f.id)),
    later,
  );
  const copies = pairs.flatMap(([from, to]) =>
    byFinding.get(from.id)!.map((opinion) => ({
      findingId: to.id,
      pullRequestId: run.pullRequestId,
      signedBy: opinion.signedBy,
      value: opinion.value,
      comment: opinion.comment,
      reviewId: opinion.reviewId,
      fromRound: opinion.fromRound,
      carriedFromId: opinion.id,
      createdAt: opinion.createdAt,
    })),
  );
  if (copies.length === 0) return 0;
  const inserted = await db
    .insert(opinions)
    .values(copies)
    .onConflictDoNothing({ target: [opinions.findingId, opinions.signedBy] })
    .returning({ id: opinions.id });
  return inserted.length;
}

export type NewOpinion = { findingId: number; value: OpinionValue; comment: string | null };

export type SaveReviewInput = {
  pullRequestId: number;
  opinions: readonly NewOpinion[];
  /** The signing Team member's id; the caller checks they are active. */
  signedBy: string;
};

export type SaveReviewResult =
  { ok: true; review: Review } | { ok: false; reason: 'not_found'; missing: number[] };

/**
 * Saves one or many opinions of one signer as one signed review, with one Timeline entry. A
 * signer's newer opinion on a finding replaces only their own; other people's opinions stay, and
 * two signers saving at once both persist (one row per finding and signer). Nits may get opinions.
 */
export async function saveReview(
  db: Transactor,
  input: SaveReviewInput,
): Promise<SaveReviewResult> {
  const byFinding = new Map(input.opinions.map((o) => [o.findingId, o]));
  const ids = [...byFinding.keys()].sort((a, b) => a - b);
  if (ids.length === 0) throw new Error('saveReview needs at least one opinion');

  return db.transaction(async (tx) => {
    await lockPullRequestRow(tx, input.pullRequestId);
    const found = await tx
      .select({ id: findings.id, roundNo: runs.roundNo })
      .from(findings)
      .innerJoin(runs, eq(runs.id, findings.runId))
      .where(and(inArray(findings.id, ids), eq(findings.pullRequestId, input.pullRequestId)));
    const known = new Set(found.map((row) => row.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) return { ok: false, reason: 'not_found', missing };

    const worth = input.opinions.filter((o) => o.value === 'worth').length;
    const [review] = await tx
      .insert(reviews)
      .values({
        pullRequestId: input.pullRequestId,
        signedBy: input.signedBy,
        worth,
        notWorth: byFinding.size - worth,
      })
      .returning();
    await tx
      .insert(opinions)
      .values(
        found.map((row) => {
          const opinion = byFinding.get(row.id)!;
          return {
            findingId: row.id,
            pullRequestId: input.pullRequestId,
            signedBy: input.signedBy,
            value: opinion.value,
            comment: opinion.comment,
            reviewId: review!.id,
            fromRound: row.roundNo ?? 1,
            createdAt: review!.createdAt,
          };
        }),
      )
      .onConflictDoUpdate({
        target: [opinions.findingId, opinions.signedBy],
        set: {
          value: sql`excluded.value`,
          comment: sql`excluded.comment`,
          reviewId: sql`excluded.review_id`,
          fromRound: sql`excluded.from_round`,
          carriedFromId: null,
          createdAt: sql`excluded.created_at`,
        },
      });
    await recordTimelineEntry(tx, {
      pullRequestId: input.pullRequestId,
      actor: { kind: 'member', memberId: input.signedBy },
      kind: 'review_saved',
      params: { worth: review!.worth, notWorth: review!.notWorth, reviewId: review!.id },
      at: review!.createdAt,
      sourceKey: `review:${review!.id}`,
    });
    await recordStateChange(
      tx,
      input.pullRequestId,
      { code: 'review_saved' },
      {
        at: review!.createdAt,
      },
    );
    return { ok: true, review: review! };
  });
}
