// Fix statuses (S-07-T3): which findings a round checks fixes for, and what it found.
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { findingFixChecks } from '../schema/chains.ts';
import { findingVerifications, findings, runs } from '../schema/runs.ts';
import { currentDecisions } from './decisions.ts';
import type { FindingRow, Run } from './runs.ts';

export type FixCheck = typeof findingFixChecks.$inferSelect;
export type FixCheckWrite = { findingId: number; resolved: boolean; reason: string };

/** A round's fix statuses; writing the same finding again in that round replaces its status. */
export async function saveFixChecks(
  db: Executor,
  runId: number,
  checks: readonly FixCheckWrite[],
): Promise<void> {
  if (checks.length === 0) return;
  await db
    .insert(findingFixChecks)
    .values(checks.map((check) => ({ ...check, runId })))
    .onConflictDoUpdate({
      target: [findingFixChecks.findingId, findingFixChecks.runId],
      set: { resolved: sql`excluded.resolved`, reason: sql`excluded.reason` },
    });
}

export function fixChecksOfRun(db: Executor, runId: number): Promise<FixCheck[]> {
  return db
    .select()
    .from(findingFixChecks)
    .where(eq(findingFixChecks.runId, runId))
    .orderBy(asc(findingFixChecks.findingId));
}

/** The newest fix status of each finding (the latest round that checked it). */
export async function newestFixChecks(
  db: Executor,
  findingIds: readonly number[],
): Promise<Map<number, FixCheck>> {
  if (findingIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(findingFixChecks)
    .where(inArray(findingFixChecks.findingId, [...findingIds]))
    .orderBy(desc(findingFixChecks.runId));
  const newest = new Map<number, FixCheck>();
  for (const row of rows) if (!newest.has(row.findingId)) newest.set(row.findingId, row);
  return newest;
}

/** The findings a round checks fixes for, and the SHA its fix diff starts from. */
export type FixTargets = { findings: FindingRow[]; fromSha: string | null };

const isFirstRound = or(eq(runs.roundNo, 1), isNull(runs.roundNo));

/**
 * A fix check (round 2 or 3) checks the findings of its chain's round 1 decided Implement, on the
 * diff since the chain's latest completed round. Round 1 of a new chain (US-05) checks the
 * findings of the PR's previous completed full round decided Implement and not resolved yet.
 */
export async function fixTargetsOfRun(
  db: Executor,
  run: Pick<Run, 'id' | 'pullRequestId' | 'chainId' | 'roundNo'>,
): Promise<FixTargets> {
  const fixCheck = (run.roundNo ?? 1) > 1;
  const earlier = and(
    eq(runs.pullRequestId, run.pullRequestId),
    eq(runs.kind, 'round'),
    eq(runs.status, 'completed'),
    lt(runs.id, run.id),
  );
  const [source] = await db
    .select()
    .from(runs)
    .where(
      fixCheck && run.chainId
        ? and(earlier, eq(runs.chainId, run.chainId), isFirstRound)
        : and(earlier, isFirstRound),
    )
    .orderBy(desc(runs.id))
    .limit(1);
  if (!source || (fixCheck && !run.chainId)) return { findings: [], fromSha: null };

  const rows = await db
    .select()
    .from(findings)
    .where(eq(findings.runId, source.id))
    .orderBy(asc(findings.ordinal));
  const decisions = await currentDecisions(
    db,
    rows.map((row) => row.id),
  );
  let targets = rows.filter((row) => decisions.get(row.id)?.decision === 'implement');
  if (!fixCheck) {
    const checks = await newestFixChecks(
      db,
      targets.map((row) => row.id),
    );
    targets = targets.filter((row) => checks.get(row.id)?.resolved !== true);
    return { findings: targets, fromSha: source.headSha };
  }

  const [previous] = await db
    .select({ headSha: runs.headSha })
    .from(runs)
    .where(and(earlier, eq(runs.chainId, run.chainId!)))
    .orderBy(desc(runs.id))
    .limit(1);
  return { findings: targets, fromSha: previous?.headSha ?? source.headSha };
}

/** The reproduction scripts Verify kept for these findings, by finding id. */
export async function reproductionScripts(
  db: Executor,
  findingIds: readonly number[],
): Promise<Map<number, string>> {
  if (findingIds.length === 0) return new Map();
  const rows = await db
    .select({ findingId: findingVerifications.findingId, script: findingVerifications.script })
    .from(findingVerifications)
    .where(inArray(findingVerifications.findingId, [...findingIds]));
  return new Map(rows.flatMap((row) => (row.script ? [[row.findingId, row.script] as const] : [])));
}
