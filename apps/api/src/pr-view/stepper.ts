// The stepper of a run, shared by Run detail and the PR page's round progress: core's
// `stepperModel` over the run's stored stage attempts and their sessions' cost.
import {
  reason,
  stepperModel,
  stepStatus,
  type StageRow,
  type StageStatus,
  type Step,
} from '@pra/core';
import type { AgentSession, Run, StageExecution } from '@pra/db';

/** Stage rows as core's stepper reads them, with each attempt's session cost. */
export function stageRows(
  stages: readonly StageExecution[],
  sessions: readonly Pick<AgentSession, 'stageExecutionId' | 'costUsd'>[],
): StageRow[] {
  return stages.map((stage) => ({
    stage: stage.stage,
    attempt: stage.attempt,
    status: stage.status as StageStatus,
    costUsd: sessions
      .filter((s) => s.stageExecutionId === stage.id)
      .reduce((sum, s) => sum + s.costUsd, 0),
    errorCode: stage.errorCode,
    startedAt: stage.startedAt,
    finishedAt: stage.finishedAt,
  }));
}

/** A step of any run kind: rounds use core's stage keys, other kinds their stored stage names. */
export type RunStep = Omit<Step, 'key'> & { key: string };

/**
 * The run's steps: rounds and trials follow their level's plan (stages it turns off included);
 * other run kinds list their stored rows.
 */
export function runSteps(
  run: Pick<Run, 'kind' | 'level' | 'roundNo'>,
  rows: readonly StageRow[],
  fork = false,
): RunStep[] {
  if (run.kind === 'round' || run.kind === 'trial') {
    const { steps } = stepperModel(
      rows,
      run.level.number,
      (run.roundNo ?? 1) > 1 ? 'fix_check' : 'full',
    );
    // A fork's plan turns a fix check's Reproductions stage off (S-16): it never gets a row.
    return steps.map((step) =>
      fork && step.key === 'reproductions' && step.status !== 'off' && step.attempt === null
        ? { ...step, status: 'off', offReason: reason('fork_read_only') }
        : step,
    );
  }
  return rows.map((row) => ({
    key: row.stage,
    status: stepStatus(row.status),
    attempt: row.attempt,
    costUsd: row.costUsd,
    errorCode: row.errorCode,
    offReason: null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }));
}
