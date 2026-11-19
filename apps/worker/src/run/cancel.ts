// S-09-T3: cancel that stops spend at once (FR-022, NFR Cancel really stops). The api and the close
// hook only record a cancel request on the run (`requestRunCancel`); the worker always finishes
// it. It hears the request on `pra_change` and aborts the run's in-flight stage (one
// AbortController per run in `RunCancellation`), or, with nothing in flight here, cancels the run
// at once. Backstops: the start of every stage job, the resend loop, the listener's reconnect and
// worker start. The mechanism is per run, not per kind, so implementer runs use it unchanged.
import { cancelRun, STAGE_ERROR } from '@pra/core';
import {
  cancelRequested,
  getRun,
  getRunContext,
  listenChanges,
  lockRun,
  runsWithStatus,
  stageExecutionsOfRun,
  updateRun,
  updateStageExecution,
  type ChangeListener,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { afterTransition } from './execute-stage.ts';
import { runStateOf } from './state.ts';

export { RunCancellation } from './cancellation.ts';

/** After a cancel aborts a stage, how long its executor gets to return its sessions. */
export const CANCEL_GRACE_MS = 2_000;

export type FinishCancelOutcome = 'not_requested' | 'aborting' | 'cancelled';

/**
 * Finishes a requested cancel. A stage in flight in this process is aborted, and `executeStage`
 * stores it as cancelled with its sessions' cost. With nothing in flight here (a queued run, or a
 * stage left running by a stopped worker) the run is cancelled at once.
 */
export async function finishCancel(deps: WorkerDeps, runId: number): Promise<FinishCancelOutcome> {
  const run = await getRun(deps.db, runId);
  if (!run || !cancelRequested(run)) return 'not_requested';
  if (deps.cancellation.abort(runId)) return 'aborting';

  const state = await deps.db.transaction(async (tx) => {
    const locked = await lockRun(tx, runId);
    if (!locked || !cancelRequested(locked)) return null;
    // A stage job may have registered between the read above and this lock.
    if (deps.cancellation.abort(runId)) return 'aborting' as const;
    const executions = await stageExecutionsOfRun(tx, runId);
    const transition = cancelRun(runStateOf(locked, executions));
    if (!transition.ok) return null;
    const now = new Date();
    for (const execution of executions.filter((e) => e.status === 'running')) {
      await updateStageExecution(tx, execution.id, {
        status: 'failed',
        errorCode: STAGE_ERROR.cancelled,
        finishedAt: now,
      });
    }
    await updateRun(tx, runId, { status: 'cancelled', currentStage: null, finishedAt: now });
    return transition.run;
  });
  if (state === 'aborting') return 'aborting';
  if (!state) return 'not_requested';

  deps.logger.info({ runId }, 'run cancelled');
  const context = await getRunContext(deps.db, runId);
  if (context) await afterTransition(deps, { deps, ...context }, state);
  return 'cancelled';
}

/** Finishes every requested cancel (worker start, the resend loop, a listener reconnect). */
export async function finishRequestedCancels(deps: WorkerDeps): Promise<number[]> {
  const finished: number[] = [];
  for (const run of await runsWithStatus(deps.db, ['queued', 'running'])) {
    if (!cancelRequested(run)) continue;
    if ((await finishCancel(deps, run.id)) !== 'not_requested') finished.push(run.id);
  }
  return finished;
}

/** Listens for cancel requests on `pra_change` (every `runs` change re-reads that run). */
export function listenForCancels(deps: WorkerDeps): ChangeListener {
  const { logger } = deps;
  const finish = (runId: number) =>
    finishCancel(deps, runId).catch((error: unknown) =>
      logger.warn({ err: error, runId }, 'cancel could not be finished'),
    );
  return listenChanges(
    deps.db,
    (change) => {
      if (change.table === 'runs' && change.runId !== null) void finish(change.runId);
    },
    {
      // Changes in the gap were not delivered.
      onReconnect: () =>
        void finishRequestedCancels(deps).catch((error: unknown) =>
          logger.warn({ err: error }, 'cancels after reconnect could not be finished'),
        ),
      onError: (error) => logger.warn({ err: error }, 'change listener error'),
    },
  );
}
