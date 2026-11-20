// Core `RunState` from the stored run and its stage attempts. Shared by the worker (stage jobs)
// and run actions that the api starts (retry, S-09-T1).
import { planRun, type RunStageKey, type RunState, type StageState } from '@pra/core';
import type { Run, StageExecution } from './runs.ts';

/** The round kind a run was planned with; P-11 stores it once fix checks exist. */
export const roundKindOf = (run: Pick<Run, 'roundNo'>) =>
  (run.roundNo ?? 1) > 1 ? ('fix_check' as const) : ('full' as const);

/**
 * The run's plan from its frozen level; on a fork PR, the steps that run PR code are off
 * (`fork_read_only`, S-16). A PR's fork flag never changes, so the plan is the same every time.
 */
export function runPlanOf(run: Run, pullRequest?: { isFork: boolean }): RunState {
  return planRun({
    kind: run.kind,
    level: run.level.number,
    roundKind: roundKindOf(run),
    roundNumber: run.roundNo,
    fork: pullRequest?.isFork ?? false,
  });
}

/**
 * The run's plan from its frozen level, with each stage's latest attempt applied. A stage with no
 * row keeps its planned status (`pending`, or `off` at this level).
 */
export function runStateOf(
  run: Run,
  executions: readonly StageExecution[],
  pullRequest?: { isFork: boolean },
): RunState {
  const plan = runPlanOf(run, pullRequest);
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
    retryFrom: (run.retryFrom as RunStageKey | null) ?? null,
    error:
      run.status === 'failed' && failed
        ? { stage: failed.key, code: failed.errorCode ?? 'stage_error' }
        : null,
  };
}

/**
 * A failed attempt's error params (`error_detail`, JSON the worker wrote), for example the missing
 * instruction files. Null when none are stored or they do not parse to an object.
 */
export function stageErrorParams(
  execution: Pick<StageExecution, 'errorDetail'>,
): Record<string, unknown> | null {
  if (!execution.errorDetail) return null;
  try {
    const params: unknown = JSON.parse(execution.errorDetail);
    return params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
