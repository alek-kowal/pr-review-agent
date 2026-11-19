import './reasons/run.ts';
import { stagesFor, type FixCheckStageKey } from './levels.ts';
import type { RoundKind, RunStatus } from './model.ts';
import { reason, type Reason } from './reason.ts';
import type { LevelNumber, RunKind, StageKey } from './vocabulary.ts';

export const IMPLEMENTER_STAGE_KEYS = ['worktree', 'implement', 'reproductions'] as const;
export const ANALYST_STAGE_KEYS = ['analyse'] as const;
export type RunStageKey =
  | StageKey
  | FixCheckStageKey
  | (typeof IMPLEMENTER_STAGE_KEYS)[number]
  | (typeof ANALYST_STAGE_KEYS)[number];

export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'off' | 'reused';

/** Error codes the machine itself sets; stages fail with any code (for example `timeout`). */
export const STAGE_ERROR = { interrupted: 'interrupted', cancelled: 'cancelled' } as const;

export interface StageState {
  key: RunStageKey;
  status: StageStatus;
  /** Why the stage is off (`off_at_level`). */
  offReason: Reason | null;
  errorCode: string | null;
}

export interface RunState {
  kind: RunKind;
  status: RunStatus;
  level: LevelNumber;
  roundKind: RoundKind | null;
  /** A retry keeps the round number. */
  roundNumber: number | null;
  /** 1, plus one per retry. A failed attempt never counts toward the chain. */
  attempt: number;
  retryFrom: RunStageKey | null;
  stages: StageState[];
  error: { stage: RunStageKey; code: string } | null;
}

export type Transition = { ok: true; run: RunState } | { ok: false; reason: Reason };

const ok = (run: RunState): Transition => ({ ok: true, run });
const refuse = (why: Reason): Transition => ({ ok: false, reason: why });
const stage = (key: RunStageKey, off = false, offReason: Reason | null = null): StageState => ({
  key,
  status: off ? 'off' : 'pending',
  offReason,
  errorCode: null,
});

export interface PlanRunInput {
  kind: RunKind;
  level: LevelNumber;
  roundKind?: RoundKind;
  roundNumber?: number | null;
}

/** A new queued run with its stage plan: the level turns stages off with `off_at_level`. */
export function planRun({ kind, level, roundKind, roundNumber = null }: PlanRunInput): RunState {
  const isRound = kind === 'round' || kind === 'trial';
  const stages = isRound
    ? stagesFor(level, roundKind ?? 'full').map((s) => stage(s.key, s.off, s.reason))
    : (kind === 'implementer' ? IMPLEMENTER_STAGE_KEYS : ANALYST_STAGE_KEYS).map((k) => stage(k));
  return {
    kind,
    status: 'queued',
    level,
    roundKind: isRound ? (roundKind ?? 'full') : null,
    roundNumber,
    attempt: 1,
    retryFrom: null,
    stages,
    error: null,
  };
}

const withStage = (run: RunState, key: RunStageKey, patch: Partial<StageState>): RunState => ({
  ...run,
  stages: run.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)),
});

/** The stage to start next, or null while one runs or when none is left. */
export function nextStage(run: RunState): RunStageKey | null {
  if (run.status !== 'running' || run.stages.some((s) => s.status === 'running')) return null;
  return run.stages.find((s) => s.status === 'pending')?.key ?? null;
}

export function startRun(run: RunState): Transition {
  if (run.status !== 'queued') return refuse(reason('run_not_queued', { status: run.status }));
  return ok({ ...run, status: 'running' });
}

export function startStage(run: RunState, key: RunStageKey): Transition {
  if (run.status !== 'running') return refuse(reason('run_not_running', { status: run.status }));
  const running = run.stages.find((s) => s.status === 'running');
  if (running) return refuse(reason('stage_already_running', { stage: running.key }));
  const target = run.stages.find((s) => s.key === key);
  if (!target) return refuse(reason('stage_not_in_plan', { stage: key }));
  if (target.status !== 'pending') {
    return refuse(reason('stage_not_pending', { stage: key, status: target.status }));
  }
  const expected = nextStage(run);
  if (expected !== key)
    return refuse(reason('stage_out_of_order', { stage: key, expected: expected ?? '' }));
  return ok(withStage(run, key, { status: 'running' }));
}

function runningStage(run: RunState, key: RunStageKey): Transition | null {
  if (run.status !== 'running') return refuse(reason('run_not_running', { status: run.status }));
  const target = run.stages.find((s) => s.key === key);
  if (!target) return refuse(reason('stage_not_in_plan', { stage: key }));
  if (target.status !== 'running') {
    return refuse(reason('stage_not_running', { stage: key, status: target.status }));
  }
  return null;
}

/** Marks the stage succeeded. The run completes when no stage is left to run. */
export function completeStage(run: RunState, key: RunStageKey): Transition {
  const refused = runningStage(run, key);
  if (refused) return refused;
  const next = withStage(run, key, { status: 'succeeded' });
  const done = !next.stages.some((s) => s.status === 'pending');
  return ok(done ? { ...next, status: 'completed' } : next);
}

/** The stage fails with an error code, and the run fails with it. */
export function failStage(run: RunState, key: RunStageKey, errorCode: string): Transition {
  const refused = runningStage(run, key);
  if (refused) return refused;
  return ok({
    ...withStage(run, key, { status: 'failed', errorCode }),
    status: 'failed',
    error: { stage: key, code: errorCode },
  });
}

/** Cancels a queued or running run; a running stage fails with `cancelled`. */
export function cancelRun(run: RunState): Transition {
  if (run.status !== 'queued' && run.status !== 'running') {
    return refuse(reason('run_finished', { status: run.status }));
  }
  return ok({
    ...run,
    status: 'cancelled',
    stages: run.stages.map((s) =>
      s.status === 'running' ? { ...s, status: 'failed', errorCode: STAGE_ERROR.cancelled } : s,
    ),
  });
}

/**
 * Retries a failed run from its failed stage: stages that succeeded are `reused`, the failed stage
 * and those after it run again, the round number stays. The run queues again.
 */
export function retryFromStage(run: RunState): Transition {
  if (run.status !== 'failed') return refuse(reason('run_not_failed', { status: run.status }));
  return ok({
    ...run,
    status: 'queued',
    attempt: run.attempt + 1,
    retryFrom: run.error?.stage ?? null,
    error: null,
    stages: run.stages.map((s): StageState => {
      if (s.status === 'succeeded' || s.status === 'reused') return { ...s, status: 'reused' };
      if (s.status === 'off') return s;
      return { ...s, status: 'pending', errorCode: null };
    }),
  });
}

/**
 * After a restart nothing stays running forever: a running stage fails with `interrupted` (so it
 * can be retried), and queued runs stay queued.
 */
export function recoverAfterRestart(run: RunState): RunState {
  const interrupted = run.stages.find((s) => s.status === 'running');
  if (run.status !== 'running' || !interrupted) return run;
  return {
    ...withStage(run, interrupted.key, { status: 'failed', errorCode: STAGE_ERROR.interrupted }),
    status: 'failed',
    error: { stage: interrupted.key, code: STAGE_ERROR.interrupted },
  };
}
