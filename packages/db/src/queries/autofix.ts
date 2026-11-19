// Level 5 autofix (S-15-T1): attempts the bot made and the shadow log of levels 3–4. Each write
// adds its Timeline entry in the same transaction (actor bot), so the PR timeline needs no join.
import { BOT, type AutofixPoint, type Reason } from '@pra/core';
import { and, asc, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import {
  autofixAttempts,
  autofixShadow,
  type AutofixOutcome,
  type ShadowDecision,
} from '../schema/autofix.ts';
import { pullRequests } from '../schema/repositories.ts';
import type { Transactor } from './decisions.ts';
import { recordTimelineEntry } from './timeline.ts';

export type AutofixAttempt = typeof autofixAttempts.$inferSelect;
export type AutofixShadowEntry = typeof autofixShadow.$inferSelect;

/**
 * Automatic patches of a chain: the implementer runs autofix started in it (PRD: N per chain). A
 * run that failed counts too, so a failing fix is not retried without end. `exceptRunId` leaves out
 * the run whose patch is being checked, so the push point counts the patches before it.
 */
export async function autoPatchesInChain(
  db: Executor,
  chainId: string,
  options: { exceptRunId?: number } = {},
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(autofixAttempts)
    .where(
      and(
        eq(autofixAttempts.chainId, chainId),
        eq(autofixAttempts.point, 'start'),
        eq(autofixAttempts.outcome, 'started'),
        options.exceptRunId === undefined
          ? undefined
          : ne(autofixAttempts.implementerRunId, options.exceptRunId),
      ),
    );
  return row?.count ?? 0;
}

export type NewAutofixAttempt = {
  pullRequestId: number;
  chainId: string | null;
  roundRunId?: number | null;
  implementerRunId?: number | null;
  patchId?: number | null;
  point: AutofixPoint;
  outcome: AutofixOutcome;
  reasons: Reason[];
  sha?: string | null;
  at?: Date;
};

/**
 * Stores one attempt with its Timeline entry: `autofix_started` or `autofix_waiting`. A `pushed`
 * attempt adds none: the push job already wrote `autofix_pushed`. A second start of the same round
 * adds nothing and returns null.
 */
export async function recordAutofixAttempt(
  db: Transactor,
  input: NewAutofixAttempt,
): Promise<AutofixAttempt | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(autofixAttempts)
      .values({
        pullRequestId: input.pullRequestId,
        chainId: input.chainId,
        roundRunId: input.roundRunId ?? null,
        implementerRunId: input.implementerRunId ?? null,
        patchId: input.patchId ?? null,
        point: input.point,
        outcome: input.outcome,
        reasons: input.reasons,
        sha: input.sha ?? null,
        ...(input.at ? { at: input.at } : {}),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    if (row.outcome !== 'pushed') {
      await recordTimelineEntry(tx, {
        pullRequestId: row.pullRequestId,
        actor: BOT,
        kind: row.outcome === 'started' ? 'autofix_started' : 'autofix_waiting',
        params: {
          point: row.point,
          reason: row.reasons[0] ?? null,
          patchId: row.patchId,
          implementerRunId: row.implementerRunId,
        },
        runId: row.implementerRunId ?? row.roundRunId,
        at: row.at,
        sourceKey: `autofix_attempt:${row.id}`,
      });
    }
    return row;
  });
}

/** The start attempt that created this implementer run; null when a person started it. */
export async function autofixStartOfRun(
  db: Executor,
  implementerRunId: number,
): Promise<AutofixAttempt | null> {
  const [row] = await db
    .select()
    .from(autofixAttempts)
    .where(
      and(
        eq(autofixAttempts.implementerRunId, implementerRunId),
        eq(autofixAttempts.point, 'start'),
      ),
    );
  return row ?? null;
}

/** Why autofix stopped before pushing this patch; null when its latest attempt is not waiting. */
export async function latestAutofixWaiting(
  db: Executor,
  patchId: number,
): Promise<AutofixAttempt | null> {
  const [row] = await db
    .select()
    .from(autofixAttempts)
    .where(eq(autofixAttempts.patchId, patchId))
    .orderBy(desc(autofixAttempts.at), desc(autofixAttempts.id))
    .limit(1);
  return row?.outcome === 'waiting' ? row : null;
}

/** The banner reason of each patch whose latest autofix attempt waits (first hold), by patch id. */
export async function autofixWaitingOf(
  db: Executor,
  patchIds: readonly number[],
): Promise<Map<number, Reason>> {
  const waiting = new Map<number, Reason>();
  if (!patchIds.length) return waiting;
  const rows = await db
    .select({
      patchId: autofixAttempts.patchId,
      outcome: autofixAttempts.outcome,
      reasons: autofixAttempts.reasons,
    })
    .from(autofixAttempts)
    .where(inArray(autofixAttempts.patchId, [...patchIds]))
    .orderBy(asc(autofixAttempts.at), asc(autofixAttempts.id));
  // Oldest first: the last row of each patch is its latest attempt.
  for (const row of rows) {
    const first = row.reasons[0];
    if (row.outcome === 'waiting' && first) waiting.set(row.patchId!, first);
    else waiting.delete(row.patchId!);
  }
  return waiting;
}

/** Attempts of a PR in time order. */
export async function autofixAttemptsOfPr(
  db: Executor,
  pullRequestId: number,
): Promise<AutofixAttempt[]> {
  return db
    .select()
    .from(autofixAttempts)
    .where(eq(autofixAttempts.pullRequestId, pullRequestId))
    .orderBy(autofixAttempts.at, autofixAttempts.id);
}

export type NewShadowEntry = {
  pullRequestId: number;
  repositoryId: number;
  runId?: number | null;
  patchId?: number | null;
  level: number;
  point: AutofixPoint;
  decision: ShadowDecision;
  reasons: Reason[];
  fixed: number;
  total: number;
  at?: Date;
};

/** Stores one shadow entry with its `autofix_shadow` Timeline entry; once per round or patch. */
export async function recordShadow(
  db: Transactor,
  input: NewShadowEntry,
): Promise<AutofixShadowEntry | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(autofixShadow)
      .values({
        pullRequestId: input.pullRequestId,
        repositoryId: input.repositoryId,
        runId: input.runId ?? null,
        patchId: input.patchId ?? null,
        level: input.level,
        point: input.point,
        decision: input.decision,
        reasons: input.reasons,
        fixed: input.fixed,
        total: input.total,
        ...(input.at ? { at: input.at } : {}),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    await recordTimelineEntry(tx, {
      pullRequestId: row.pullRequestId,
      actor: BOT,
      kind: 'autofix_shadow',
      params: {
        point: row.point,
        decision: row.decision,
        reason: row.reasons[0] ?? null,
        fixed: row.fixed,
        total: row.total,
        level: row.level,
      },
      runId: row.runId,
      at: row.at,
      sourceKey: `autofix_shadow:${row.id}`,
    });
    return row;
  });
}

/** Shadow entries of a PR in time order. */
export async function shadowOfPr(
  db: Executor,
  pullRequestId: number,
): Promise<AutofixShadowEntry[]> {
  return db
    .select()
    .from(autofixShadow)
    .where(eq(autofixShadow.pullRequestId, pullRequestId))
    .orderBy(autofixShadow.at, autofixShadow.id);
}

export type RepositoryShadowEntry = AutofixShadowEntry & { number: number };

/**
 * The latest shadow entry of each PR since `since` at `minLevel` or above, newest first, for one
 * repository or all of them (Insights → Trust ladder).
 */
export async function shadowByRepository(
  db: Executor,
  query: { repositoryId?: number; since: Date; minLevel: number },
): Promise<RepositoryShadowEntry[]> {
  const rows = await db
    .select({ entry: autofixShadow, number: pullRequests.number })
    .from(autofixShadow)
    .innerJoin(pullRequests, eq(pullRequests.id, autofixShadow.pullRequestId))
    .where(
      and(
        query.repositoryId === undefined
          ? undefined
          : eq(autofixShadow.repositoryId, query.repositoryId),
        gte(autofixShadow.at, query.since),
        gte(autofixShadow.level, query.minLevel),
      ),
    )
    .orderBy(desc(autofixShadow.at), desc(autofixShadow.id));
  // Newest first: the first row of each PR is its latest entry.
  const latest = new Map<number, RepositoryShadowEntry>();
  for (const row of rows) {
    if (!latest.has(row.entry.pullRequestId)) {
      latest.set(row.entry.pullRequestId, { ...row.entry, number: row.number });
    }
  }
  return [...latest.values()];
}
