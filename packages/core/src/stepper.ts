import { stagesFor } from './levels.ts';
import type { RoundKind } from './model.ts';
import type { Reason } from './reason.ts';
import type { RunStageKey, StageStatus } from './run.ts';
import type { LevelNumber } from './vocabulary.ts';

/** One attempt at one stage, as stored (`stage_executions` plus its sessions' cost). */
export interface StageRow {
  stage: string;
  attempt: number;
  status: StageStatus;
  /** Sum of the attempt's agent sessions. */
  costUsd: number;
  errorCode: string | null;
  /** The error's params, as the worker stored them (the files of an instructions error). */
  errorParams?: Record<string, unknown> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Why the stage is off, as the worker stored it. */
  offReason?: Reason | null;
}

export type StepStatus = 'done' | 'running' | 'failed' | 'queued' | 'off';

export interface Step {
  key: RunStageKey;
  status: StepStatus;
  /** Every attempt of the stage: spent money, also for failed attempts. */
  costUsd: number;
  /** The latest attempt; null before the stage first starts. */
  attempt: number | null;
  errorCode: string | null;
  /** Set with `errorCode` when the worker stored params. */
  errorParams?: Record<string, unknown>;
  offReason: Reason | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface StepperModel {
  steps: Step[];
  /** The running stage, or null. */
  current: RunStageKey | null;
  costUsd: number;
}

const STEP_STATUS: Readonly<Record<StageStatus, StepStatus>> = {
  pending: 'queued',
  running: 'running',
  succeeded: 'done',
  reused: 'done',
  failed: 'failed',
  off: 'off',
};

/** How the stepper shows a stored stage status. */
export const stepStatus = (status: StageStatus): StepStatus => STEP_STATUS[status];

/**
 * The stepper of a round: its stages in run order at the run's level and round kind (the level
 * lists the stages it switches off), each with the status of its latest stored attempt and the
 * cost of all its attempts. A row for a stage the plan does not hold is not shown.
 */
export function stepperModel(
  stageRows: readonly StageRow[],
  level: LevelNumber,
  roundKind: RoundKind,
): StepperModel {
  const steps = stagesFor(level, roundKind).map((planned): Step => {
    const rows = stageRows.filter((row) => row.stage === planned.key);
    const latest = rows.reduce<StageRow | null>(
      (a, b) => (!a || b.attempt > a.attempt ? b : a),
      null,
    );
    const costUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
    if (planned.off) {
      return {
        key: planned.key,
        status: 'off',
        costUsd,
        attempt: null,
        errorCode: null,
        offReason: latest?.offReason ?? planned.reason,
        startedAt: null,
        finishedAt: null,
      };
    }
    return {
      key: planned.key,
      status: latest ? STEP_STATUS[latest.status] : 'queued',
      costUsd,
      attempt: latest?.attempt ?? null,
      errorCode: latest?.errorCode ?? null,
      ...(latest?.errorCode && latest.errorParams ? { errorParams: latest.errorParams } : {}),
      offReason: null,
      startedAt: latest?.startedAt ?? null,
      finishedAt: latest?.finishedAt ?? null,
    };
  });
  return {
    steps,
    current: steps.find((step) => step.status === 'running')?.key ?? null,
    costUsd: steps.reduce((sum, step) => sum + step.costUsd, 0),
  };
}
