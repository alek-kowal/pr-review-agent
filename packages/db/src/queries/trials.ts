// S-22-T6: trials. A trial is two runs of kind `trial` on the PR's current commit: A reads the
// active instructions, B reads them with a draft in place of its file's active version. Trials
// start unsigned ("Started by hand") and never block or change the PR.
import { planRun, reason, type Actor, type Reason } from '@pra/core';
import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../client.ts';
import { instructionFiles, instructionVersions } from '../schema/instructions.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { agentSessions, runs, stageExecutions } from '../schema/runs.ts';
import { trials } from '../schema/trials.ts';
import { getAppSettings } from './app-settings.ts';
import { getInstructionVersion, type InstructionVersion } from './instructions.ts';
import { prLevel } from './pr-state.ts';
import type { Run } from './runs.ts';
import { createRun, type RunStartDeps } from './start-round.ts';

export type Trial = typeof trials.$inferSelect;

export type StartTrialInput = {
  pullRequestId: number;
  /** The draft run B reads. */
  draftVersionId: number;
  startedBy: Actor;
};

export type StartTrialResult =
  { started: true; trial: Trial; runA: Run; runB: Run } | { started: false; reason: Reason };

/**
 * Starts a trial: the row first, then run A and run B, each of which records itself on the row in
 * its insert transaction, so the worker finds the draft before run B's first stage starts.
 */
export async function startTrial(
  deps: RunStartDeps,
  input: StartTrialInput,
): Promise<StartTrialResult> {
  const [row] = await deps.db
    .select({ repository: repositories, pullRequest: pullRequests })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(eq(pullRequests.id, input.pullRequestId));
  if (!row) {
    return {
      started: false,
      reason: reason('pr_not_found', { pullRequestId: input.pullRequestId }),
    };
  }
  const draft = await getInstructionVersion(deps.db, input.draftVersionId);
  if (draft?.status !== 'draft') {
    return {
      started: false,
      reason: reason('trial_needs_draft', {
        versionId: input.draftVersionId,
        status: draft?.status ?? null,
      }),
    };
  }
  const { repository, pullRequest } = row;
  const level = prLevel(
    repository,
    pullRequest,
    (await getAppSettings(deps.db)).value.defaultLevel,
  );
  const [trial] = await deps.db
    .insert(trials)
    .values({
      pullRequestId: pullRequest.id,
      draftVersionId: draft.id,
      headSha: pullRequest.headSha,
      startedBy: input.startedBy.kind,
      startedByMemberId: input.startedBy.kind === 'member' ? input.startedBy.memberId : null,
    })
    .returning();

  const sides: Run[] = [];
  for (const side of ['a', 'b'] as const) {
    const created = await createRun(deps, {
      // Both runs review the commit the trial recorded.
      pullRequest: { ...pullRequest, headSha: trial!.headSha },
      kind: 'trial',
      level,
      plan: planRun({ kind: 'trial', level }),
      trigger: 'trial',
      startedBy: input.startedBy,
      inTransaction: (tx, run) => setTrialRun(tx, trial!.id, side, run.id),
    });
    // Trial runs never block, so a start is never refused.
    if (!created.created) throw new Error(`trial run ${side} not created: ${created.reason}`);
    sides.push(created.run);
  }
  const stored = await getTrial(deps.db, trial!.id);
  return { started: true, trial: stored!, runA: sides[0]!, runB: sides[1]! };
}

async function setTrialRun(tx: Executor, trialId: number, side: 'a' | 'b', runId: number) {
  await tx
    .update(trials)
    .set(side === 'a' ? { runAId: runId } : { runBId: runId })
    .where(eq(trials.id, trialId));
}

export async function getTrial(db: Executor, id: number): Promise<Trial | null> {
  const [trial] = await db.select().from(trials).where(eq(trials.id, id));
  return trial ?? null;
}

/** A trial with its PR, its draft and its file, and the status of both runs. */
export type TrialSummary = Trial & {
  repositorySlug: string;
  prNumber: number;
  prTitle: string;
  draft: { id: number; fileId: number; fileKey: string; version: number; status: string };
  runAStatus: string | null;
  runBStatus: string | null;
};

const runA = alias(runs, 'run_a');
const runB = alias(runs, 'run_b');

function selectTrialSummaries(db: Executor) {
  return db
    .select({
      trial: trials,
      repositorySlug: repositories.slug,
      prNumber: pullRequests.number,
      prTitle: pullRequests.title,
      draft: {
        id: instructionVersions.id,
        fileId: instructionVersions.fileId,
        fileKey: instructionFiles.fileKey,
        version: instructionVersions.version,
        status: instructionVersions.status,
      },
      runAStatus: runA.status,
      runBStatus: runB.status,
    })
    .from(trials)
    .innerJoin(pullRequests, eq(pullRequests.id, trials.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .innerJoin(instructionVersions, eq(instructionVersions.id, trials.draftVersionId))
    .innerJoin(instructionFiles, eq(instructionFiles.id, instructionVersions.fileId))
    .leftJoin(runA, eq(runA.id, trials.runAId))
    .leftJoin(runB, eq(runB.id, trials.runBId));
}

const toSummary = ({ trial, ...rest }: { trial: Trial } & Omit<TrialSummary, keyof Trial>) => ({
  ...trial,
  ...rest,
});

/** Trials, newest first. */
export async function listTrials(
  db: Executor,
  options: { limit?: number } = {},
): Promise<TrialSummary[]> {
  const rows = await selectTrialSummaries(db)
    .orderBy(desc(trials.createdAt), desc(trials.id))
    .limit(options.limit ?? 100);
  return rows.map(toSummary);
}

export async function getTrialSummary(db: Executor, id: number): Promise<TrialSummary | null> {
  const [row] = await selectTrialSummaries(db).where(eq(trials.id, id));
  return row ? toSummary(row) : null;
}

/** The cost of each run's agent sessions, by run id (a run without sessions costs 0). */
export async function sessionCostsOfRuns(
  db: Executor,
  runIds: readonly number[],
): Promise<Map<number, number>> {
  const costs = new Map(runIds.map((id) => [id, 0]));
  if (!runIds.length) return costs;
  const rows = await db
    .select({
      runId: stageExecutions.runId,
      cost: sql<string>`coalesce(sum(${agentSessions.costUsd}), 0)`,
    })
    .from(agentSessions)
    .innerJoin(stageExecutions, eq(stageExecutions.id, agentSessions.stageExecutionId))
    .where(inArray(stageExecutions.runId, [...runIds]))
    .groupBy(stageExecutions.runId);
  for (const row of rows) costs.set(row.runId, Number(row.cost));
  return costs;
}

/** The trial a run belongs to and its side; null for a run that is not part of a trial. */
export async function trialOfRun(
  db: Executor,
  runId: number,
): Promise<{ trial: Trial; side: 'a' | 'b' } | null> {
  const [trial] = await db
    .select()
    .from(trials)
    .where(or(eq(trials.runAId, runId), eq(trials.runBId, runId)));
  if (!trial) return null;
  return { trial, side: trial.runAId === runId ? 'a' : 'b' };
}

/**
 * The versions a trial run reads in place of the active ones: run B's draft, nothing for run A or
 * for a run that is not part of a trial.
 */
export async function trialReplacements(
  db: Executor,
  runId: number,
): Promise<InstructionVersion[]> {
  const found = await trialOfRun(db, runId);
  if (found?.side !== 'b') return [];
  const draft = await getInstructionVersion(db, found.trial.draftVersionId);
  return draft ? [draft] : [];
}
