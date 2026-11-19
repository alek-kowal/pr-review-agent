// At worker start (NFR Durability): a stage left running by a stopped worker fails with
// `interrupted`, and queued or running runs whose next stage job was lost get it again (the
// `run.stage` queue drops a duplicate while one is queued or active).
import { nextStage, recoverAfterRestart } from '@pra/core';
import {
  getRunContext,
  lockRun,
  runsWithStatus,
  stageExecutionsOfRun,
  updateRun,
  updateStageExecution,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { afterTransition } from './execute-stage.ts';
import { sendStageJob } from './jobs.ts';
import { runStateOf } from './state.ts';

export type RecoveryResult = { interrupted: number[]; resent: number[] };

export async function recoverRuns(deps: WorkerDeps): Promise<RecoveryResult> {
  const { db, logger } = deps;
  const result: RecoveryResult = { interrupted: [], resent: [] };

  for (const candidate of await runsWithStatus(db, ['queued', 'running'])) {
    const interrupted = await db.transaction(async (tx) => {
      const run = await lockRun(tx, candidate.id);
      if (!run || run.status !== 'running') return null;
      const executions = await stageExecutionsOfRun(tx, run.id);
      const state = runStateOf(run, executions);
      const recovered = recoverAfterRestart(state);
      if (recovered === state) return null;
      const stage = recovered.error!.stage;
      const execution = executions
        .filter((e) => e.stage === stage && e.status === 'running')
        .at(-1);
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
    });

    if (interrupted) {
      result.interrupted.push(candidate.id);
      const context = await getRunContext(db, candidate.id);
      if (context) await afterTransition(deps, { deps, ...context }, interrupted);
      continue;
    }

    const run = (await getRunContext(db, candidate.id))?.run;
    if (!run) continue;
    const state = runStateOf(run, await stageExecutionsOfRun(db, run.id));
    const next =
      state.status === 'queued'
        ? (state.stages.find((s) => s.status === 'pending')?.key ?? null)
        : state.status === 'running'
          ? nextStage(state)
          : null;
    if (next) {
      await sendStageJob(deps.queue, run.id, next);
      result.resent.push(run.id);
    }
  }
  if (result.interrupted.length || result.resent.length) {
    logger.info(result, 'runs recovered after start');
  }
  return result;
}
