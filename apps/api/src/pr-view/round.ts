// The round summary shared by the PR page sections: status, frozen level, who started it, cost,
// and every planned stage with its latest attempt (stages the level turns off show as `off`).
import { reason, stagesFor, type Reason } from '@pra/core';
import { RUN_STATUSES, STAGE_STATUSES, type Run, type StageExecution } from '@pra/db';
import { z } from 'zod/v4';
import { offStepsOf } from './off-steps.ts';

export const ReasonSchema = z.object({
  code: z.string(),
  params: z.record(z.string(), z.unknown()),
});

export const ActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), memberId: z.string() }),
  z.object({ kind: z.literal('bot') }),
  z.object({ kind: z.literal('hand') }),
]);

const timestamp = z.iso.datetime({ offset: true });

export const RoundLevelSchema = z.object({ number: z.number().int(), key: z.string() });

/** A step inside a running stage that the plan turns off (S-16-T3), with its reason. */
export const OffStepSchema = z.object({ step: z.string(), reason: ReasonSchema });

export const StageSchema = z.object({
  key: z.string(),
  status: z.enum(STAGE_STATUSES),
  /** The latest attempt; null for a stage that never started. */
  attempt: z.number().int().nullable(),
  /** Why the level turns the stage off (`off_at_level`). */
  offReason: ReasonSchema.nullable(),
  /** Steps inside a running stage the plan turns off: a fork's install and reproductions. */
  offSteps: z.array(OffStepSchema),
  errorCode: z.string().nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
});

export const RoundSchema = z.object({
  id: z.number().int(),
  /** Round number in its chain. */
  number: z.number().int().nullable(),
  status: z.enum(RUN_STATUSES),
  level: RoundLevelSchema,
  startedBy: ActorSchema,
  /** Why the round started, as a reason code. */
  trigger: z.string(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  costUsd: z.number(),
  stages: z.array(StageSchema),
  /** The stage and error code a failed round stopped at. */
  error: z.object({ stage: z.string(), code: z.string() }).nullable(),
});
export type RoundView = z.output<typeof RoundSchema>;

export const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export function roundLevel(run: Run): z.output<typeof RoundLevelSchema> {
  return { number: run.level.number, key: run.level.key };
}

function startedBy(run: Run): z.output<typeof ActorSchema> {
  if (run.startedBy === 'member') return { kind: 'member', memberId: run.startedByMemberId ?? '' };
  return { kind: run.startedBy };
}

/**
 * The round as the PR page shows it; `executions` are all of the run's stage attempts. On a fork
 * the plan turns install and reproductions off, and a fix check's Reproductions stage too.
 */
export function roundView(run: Run, executions: StageExecution[], fork = false): RoundView {
  const latest = new Map<string, StageExecution>();
  for (const execution of executions) {
    const seen = latest.get(execution.stage);
    if (!seen || execution.attempt >= seen.attempt) latest.set(execution.stage, execution);
  }

  const roundKind = (run.roundNo ?? 1) > 1 ? 'fix_check' : 'full';
  const planned = stagesFor(run.level.number, roundKind);
  const keys = [
    ...planned.map((stage) => stage.key as string),
    ...[...latest.keys()].filter((key) => !planned.some((stage) => stage.key === key)),
  ];
  const stages = keys.map((key) => {
    const plan = planned.find((stage) => stage.key === key);
    const execution = latest.get(key);
    const forkOff = fork && plan && !plan.off && key === 'reproductions';
    const off = plan?.off || forkOff;
    const offReason: Reason | null = plan?.off
      ? plan.reason
      : forkOff
        ? reason('fork_read_only')
        : null;
    const status = execution?.status ?? (off ? 'off' : 'pending');
    return {
      key,
      status,
      attempt: execution?.attempt ?? null,
      offReason,
      offSteps: offStepsOf(run, fork, { key, status }),
      errorCode: execution?.errorCode ?? null,
      startedAt: iso(execution?.startedAt ?? null),
      finishedAt: iso(execution?.finishedAt ?? null),
    } satisfies z.output<typeof StageSchema>;
  });

  const failed = run.status === 'failed' ? stages.find((s) => s.status === 'failed') : undefined;
  return {
    id: run.id,
    number: run.roundNo,
    status: run.status,
    level: roundLevel(run),
    startedBy: startedBy(run),
    trigger: run.trigger,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    costUsd: run.costUsd,
    stages,
    error: failed ? { stage: failed.key, code: failed.errorCode ?? 'unknown' } : null,
  };
}
