// At worker start (NFR Durability): a stage left running by a stopped worker fails with
// `interrupted`. At start and then every few minutes, jobs a lost send left missing are sent
// again: the next stage of queued or running runs (the `run.stage` queue drops a duplicate while
// one is queued or active) and stored GitHub events nobody processed (fixed job id per delivery).
import { nextStage, STAGE_ERROR } from '@pra/core';
import {
  cancelRequested,
  getRunContext,
  githubEventJobId,
  JOBS,
  lockRun,
  patchesAwaitingCheck,
  runsWithStatus,
  sendJob,
  sendPatchCheckJob,
  stageExecutionsOfRun,
  unprocessedGithubEvents,
  type Run,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { resendLostFollowUps } from '../handlers/clickup-follow-up.ts';
import { finishCancel, finishRequestedCancels } from './cancel.ts';
import { afterTransition } from './execute-stage.ts';
import { interruptRunningStage } from './interrupt.ts';
import { sendStageJob } from './jobs.ts';
import { runStateOf } from './state.ts';

/** Events are re-sent from this age (their own send has had time) up to a day old. */
const EVENT_RESEND_AFTER_MS = 60_000;
const EVENT_RESEND_WITHIN_MS = 24 * 60 * 60_000;

export type ResendResult = {
  resent: number[];
  events: number[];
  followUps: number[];
  /** Patches whose check was sent again. */
  patchChecks: number[];
};
export type RecoveryResult = ResendResult & { interrupted: number[] };

/** Only at worker start: before it, no handler of this process runs a stage. */
export async function recoverRuns(deps: WorkerDeps): Promise<RecoveryResult> {
  const { db, logger } = deps;
  const interrupted: number[] = [];
  // A run with a cancel request is cancelled, not interrupted (nothing of ours runs yet).
  const cancelled = await finishRequestedCancels(deps);
  if (cancelled.length) logger.info({ cancelled }, 'requested cancels finished after start');

  for (const candidate of await runsWithStatus(db, ['running'])) {
    const state = await db.transaction(async (tx) => {
      const run = await lockRun(tx, candidate.id);
      if (!run || run.status !== 'running') return null;
      // One worker process: at its start no stage of ours is live (S-09-T6).
      return interruptRunningStage(
        tx,
        run,
        await stageExecutionsOfRun(tx, run.id),
        STAGE_ERROR.interruptedByRestart,
      );
    });
    if (!state) continue;
    interrupted.push(candidate.id);
    const context = await getRunContext(db, candidate.id);
    if (context) await afterTransition(deps, { deps, ...context }, state);
  }

  const result = { interrupted, ...(await resendLostJobs(deps)) };
  if (result.interrupted.length || result.resent.length || result.events.length) {
    logger.info(result, 'runs recovered after start');
  }
  return result;
}

/**
 * Sends the job of the stage a queued or running run waits for: its first pending stage while
 * queued, its next stage while running. False when there is none (the run is not active).
 */
export async function sendPendingStageJob(
  deps: Pick<WorkerDeps, 'db' | 'queue'>,
  run: Run,
): Promise<boolean> {
  if (run.status !== 'queued' && run.status !== 'running') return false;
  const state = runStateOf(run, await stageExecutionsOfRun(deps.db, run.id));
  const next =
    state.status === 'queued'
      ? (state.stages.find((s) => s.status === 'pending')?.key ?? null)
      : nextStage(state);
  if (!next) return false;
  await sendStageJob(deps.queue, run.id, next, run);
  return true;
}

/** Sends again every job a lost send left missing. Safe at any time: duplicates are dropped. */
export async function resendLostJobs(
  deps: WorkerDeps,
  now: Date = new Date(),
): Promise<ResendResult> {
  const { db } = deps;
  const result: ResendResult = { resent: [], events: [], followUps: [], patchChecks: [] };

  for (const run of await runsWithStatus(db, ['queued', 'running'])) {
    // A cancel the listener missed is finished here instead (S-09-T3 backstop).
    if (cancelRequested(run)) {
      await finishCancel(deps, run.id);
      continue;
    }
    if (await sendPendingStageJob(deps, run)) result.resent.push(run.id);
  }

  const events = await unprocessedGithubEvents(db, {
    from: new Date(now.getTime() - EVENT_RESEND_WITHIN_MS),
    to: new Date(now.getTime() - EVENT_RESEND_AFTER_MS),
  });
  for (const event of events) {
    await sendJob(
      deps.queue,
      JOBS.githubEvent,
      { eventId: event.id },
      { id: githubEventJobId(event.deliveryId) },
    );
    result.events.push(event.id);
  }

  result.followUps = await resendLostFollowUps(deps, now);

  // A patch left `checking` by a lost send or a failed check: one waits per patch, so a resend
  // while its check is queued is dropped, and a check that finds nothing to do returns at once.
  for (const patchId of await patchesAwaitingCheck(db)) {
    if (await sendPatchCheckJob(deps.queue, patchId)) result.patchChecks.push(patchId);
  }
  return result;
}
