// Core `RunState` from the stored run and its stage attempts. Shared by the worker (stage jobs)
// and run actions that the api starts (retry, S-09-T1).
import { planRun, type RunStageKey, type RunState, type StageState } from '@pra/core';
import type { Run, StageExecution } from './runs.ts';

/** The round kind a run was planned with; P-11 stores it once fix checks exist. */
export const roundKindOf = (run: Pick<Run, 'roundNo'>) =>
  (run.roundNo ?? 1) > 1 ? ('fix_check' as const) : ('full' as const);

/**
 * The run's plan from its frozen level, with each stage's latest attempt applied. A stage with no
 * row keeps its planned status (`pending`, or `off` at this level).
 */
export function runStateOf(run: Run, executions: readonly StageExecution[]): RunState {
  const plan = planRun({
    kind: run.kind,
    level: run.level.number,
    roundKind: roundKindOf(run),
    roundNumber: run.roundNo,
  });
  const latest = new Map<string, StageExecution>();
  for (const execution of executions) {
    const seen = latest.get(execution.stage);
    if (!seen || seen.attempt < execution.attempt) latest.set(execution.stage, execution);
  }
  const stages = plan.stages.map((stage): StageState => {
    const row = latest.get(stage.key);
    return row ? { ...stage, status: row.status, errorCode: row.errorCode } : stage;
  });
  const failed = stages.find((s) => s.status === 'failed');
  return {
    ...plan,
    status: run.status,
    stages,
    // A retry starts from its first stage that is not reused.
    retryFrom: run.retryOf
      ? (stages.find((s) => s.status !== 'reused' && s.status !== 'off')?.key ?? null)
      : null,
    error:
      run.status === 'failed' && failed
        ? { stage: failed.key, code: failed.errorCode ?? 'stage_error' }
        : null,
  };
}

/** The latest attempt of one stage, if any. */
export function latestAttempt(
  executions: readonly StageExecution[],
  stage: RunStageKey | string,
): StageExecution | null {
  return executions
    .filter((e) => e.stage === stage)
    .reduce<StageExecution | null>((a, b) => (!a || b.attempt > a.attempt ? b : a), null);
}
