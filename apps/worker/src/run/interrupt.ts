// A stage attempt that no handler runs any more (the worker restarted, or the handler threw after
// the start) fails `interrupted`, and its run fails with it (core `recoverAfterRestart`).
import { recoverAfterRestart, type RunState } from '@pra/core';
import {
  updateRun,
  updateStageExecution,
  type Executor,
  type Run,
  type StageExecution,
} from '@pra/db';
import { runStateOf } from './state.ts';

/**
 * Fails the run's running stage `interrupted`, in the caller's transaction with the run row
 * locked. Returns the failed state, or null when the run has no running stage.
 */
export async function interruptRunningStage(
  tx: Executor,
  run: Run,
  executions: readonly StageExecution[],
): Promise<RunState | null> {
  const state = runStateOf(run, executions);
  const recovered = recoverAfterRestart(state);
  if (recovered === state) return null;
  const stage = recovered.error!.stage;
  const execution = executions.filter((e) => e.stage === stage && e.status === 'running').at(-1);
  const now = new Date();
  if (execution) {
    await updateStageExecution(tx, execution.id, {
      status: 'failed',
      errorCode: recovered.error!.code,
      finishedAt: now,
    });
  }
  await updateRun(tx, run.id, { status: 'failed', finishedAt: now });
  return recovered;
}
