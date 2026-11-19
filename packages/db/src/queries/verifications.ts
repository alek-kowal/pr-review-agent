// Verdicts the Verify stage (S-05-T2) writes on a round's findings, with how it reached them.
import type { Evidence, Verdict } from '@pra/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { findings, findingVerifications } from '../schema/runs.ts';
import { lockRun } from './run-engine.ts';
import type { FindingRow } from './runs.ts';

export type FindingVerification = typeof findingVerifications.$inferSelect;

/** One finding's result: its new verdict and kept quotes, and the `finding_verifications` row. */
export type VerificationWrite = Omit<
  typeof findingVerifications.$inferInsert,
  'id' | 'runId' | 'createdAt' | 'verdict'
> & {
  findingId: number;
  verdict: Verdict;
  /** Quotes found word for word; stored as the finding's evidence. */
  evidence: Evidence[];
};

/** A run's findings in their stored order. */
export function findingsOfRun(db: Db, runId: number): Promise<FindingRow[]> {
  return db.select().from(findings).where(eq(findings.runId, runId)).orderBy(asc(findings.ordinal));
}

/**
 * Writes the verdicts in one transaction under the run's lock, only while the run is still
 * running (a cancelled or finished run keeps what it had). Each finding's version is bumped.
 * Returns whether anything was written.
 */
export async function saveVerifications(
  db: Db,
  runId: number,
  writes: readonly VerificationWrite[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (run?.status !== 'running') return false;
    for (const { evidence, ...row } of writes) {
      await tx
        .update(findings)
        .set({ verdict: row.verdict, evidence, version: sql`${findings.version} + 1` })
        .where(and(eq(findings.id, row.findingId), eq(findings.runId, runId)));
      const values = { ...row, runId };
      await tx
        .insert(findingVerifications)
        .values(values)
        .onConflictDoUpdate({ target: findingVerifications.findingId, set: values });
    }
    return true;
  });
}

/** A run's verification rows, by finding id. */
export function verificationsOfRun(db: Executor, runId: number): Promise<FindingVerification[]> {
  return db
    .select()
    .from(findingVerifications)
    .where(eq(findingVerifications.runId, runId))
    .orderBy(asc(findingVerifications.findingId));
}
