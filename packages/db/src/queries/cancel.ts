// S-09-T3: a cancel request. Whoever asks (the api by hand, the close hook as the bot) only records
// who asked and why; the run stays queued or running until the worker has stopped its work and set
// `cancelled` (`apps/worker/src/run/cancel.ts`). There is no `cancelling` status (change.md).
import { reason, type Actor, type Reason } from '@pra/core';
import { JOBS, type Queue } from '../queue.ts';
import type { CancelReason } from '../schema/runs.ts';
import type { Transactor } from './decisions.ts';
import { lockRun, updateRun } from './run-engine.ts';
import type { Run } from './runs.ts';

export type CancelRequest = { actor: Actor; reason: CancelReason };

export type RequestCancelResult =
  { requested: true; run: Run } | { requested: false; reason: Reason };

/** A run waits for the worker to finish its cancel. */
export const cancelRequested = (run: Pick<Run, 'status' | 'cancelRequestedAt'>): boolean =>
  run.cancelRequestedAt !== null && (run.status === 'queued' || run.status === 'running');

/**
 * Asks to cancel a queued or running run: `run_finished` for any other, `run_not_found` when it
 * does not exist. A second request keeps the first asker and reason.
 */
export async function requestRunCancel(
  db: Transactor,
  runId: number,
  request: CancelRequest,
): Promise<RequestCancelResult> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (!run) return { requested: false, reason: reason('run_not_found', { runId }) };
    if (run.status !== 'queued' && run.status !== 'running') {
      return { requested: false, reason: reason('run_finished', { status: run.status }) };
    }
    if (run.cancelRequestedAt) return { requested: true, run };
    const patch = {
      cancelRequestedAt: new Date(),
      cancelledBy: request.actor.kind,
      cancelledByMemberId: request.actor.kind === 'member' ? request.actor.memberId : null,
      cancelReason: request.reason,
    } satisfies Partial<Run>;
    await updateRun(tx, runId, patch);
    return { requested: true, run: { ...run, ...patch } };
  });
}

/** The actor who cancelled a run (for its timeline entry); the bot when nobody is stored. */
export function cancelActor(run: Pick<Run, 'cancelledBy' | 'cancelledByMemberId'>): Actor {
  if (run.cancelledBy === 'member' && run.cancelledByMemberId) {
    return { kind: 'member', memberId: run.cancelledByMemberId };
  }
  return run.cancelledBy === 'hand' ? { kind: 'hand' } : { kind: 'bot' };
}

/**
 * Deletes the run's `run.stage` jobs that no handler took yet. A job that slips through finds the
 * run cancelled and does nothing.
 */
export async function deleteQueuedStageJobs(queue: Queue, runId: number): Promise<number> {
  const jobs = await queue.findJobs(JOBS.runStage, { data: { runId }, queued: true });
  if (!jobs.length) return 0;
  await queue.deleteJob(
    JOBS.runStage,
    jobs.map((job) => job.id),
  );
  return jobs.length;
}
