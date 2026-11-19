// S-22-T6: trials. A trial is two runs of kind `trial` on the PR's current commit: A reads the
// active instructions, B reads them with a draft in place of its file's active version. Trials
// start unsigned ("Started by hand") and never block or change the PR.
import { planRun, reason, type Actor, type Reason } from '@pra/core';
import { desc, eq, or } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { trials } from '../schema/trials.ts';
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
  const level = prLevel(repository, pullRequest);
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

  const runs: Run[] = [];
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
    runs.push(created.run);
  }
  const stored = await getTrial(deps.db, trial!.id);
  return { started: true, trial: stored!, runA: runs[0]!, runB: runs[1]! };
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

/** Trials, newest first. */
export async function listTrials(db: Executor, options: { limit?: number } = {}): Promise<Trial[]> {
  return db
    .select()
    .from(trials)
    .orderBy(desc(trials.createdAt), desc(trials.id))
    .limit(options.limit ?? 100);
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
