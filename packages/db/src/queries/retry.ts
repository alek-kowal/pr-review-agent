// S-09-T1: Retry from the failed stage (FR-024). The retry is a new run row linked by `retry_of`
// for the same round: same chain, round number, frozen level and reviewed head. Stages the failed
// run finished are copied as `reused` rows with their output, and so is what they wrote outside
// it (findings, questions, fix checks, the reviewer's "not checked"); the failed stage and the
// ones after it run again. The failed run keeps its status and cost, so it never counts toward the
// chain; the retry counts once it completes.
import { reason, retryFromStage, type Actor, type Reason } from '@pra/core';
import { asc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { findingFixChecks } from '../schema/chains.ts';
import { findings, questions } from '../schema/runs.ts';
import { activeBlockingRun, getRun, lockRun, stageExecutionsOfRun } from './run-engine.ts';
import { latestAttempt, runStateOf } from './run-state.ts';
import { insertRun, insertStageExecution, isUniqueViolation, type Run } from './runs.ts';
import { sendStageJob, type RunStartDeps } from './start-round.ts';

export type RetryRunResult =
  | { retried: true; run: Run; failedRun: Run; fromStage: string }
  | { retried: false; reason: Reason };

export type RetryRunOptions = {
  /** Runs in the transaction that inserts the retry (for example its timeline entry). */
  inTransaction?: (tx: Executor, retry: Run, failedRun: Run, fromStage: string) => Promise<unknown>;
};

type Inserted = { run: Run; failedRun: Run; fromStage: string };

/** Queues a retry of a failed run; refuses a run that did not fail or a PR held by another run. */
export async function retryRun(
  deps: RunStartDeps,
  runId: number,
  startedBy: Actor,
  options: RetryRunOptions = {},
): Promise<RetryRunResult> {
  let inserted: Inserted | Reason;
  try {
    inserted = await deps.db.transaction((tx) =>
      insertRetry(tx, runId, startedBy, options.inTransaction),
    );
  } catch (error) {
    if (!isUniqueViolation(error, 'runs_one_active_per_pr')) throw error;
    const failed = await getRun(deps.db, runId);
    const active = failed ? await activeBlockingRun(deps.db, failed.pullRequestId) : null;
    return {
      retried: false,
      reason: reason('run_active', {
        kind: active?.kind ?? 'round',
        status: active?.status === 'running' ? 'running' : 'queued',
      }),
    };
  }
  if ('code' in inserted) return { retried: false, reason: inserted };
  const { run, fromStage } = inserted;
  await sendStageJob(deps.queue, run.id, fromStage, run);
  deps.logger?.info(
    { runId: run.id, retryOf: runId, pullRequestId: run.pullRequestId, stage: fromStage },
    'retry queued',
  );
  return { retried: true, ...inserted };
}

async function insertRetry(
  tx: Executor,
  runId: number,
  startedBy: Actor,
  inTransaction: RetryRunOptions['inTransaction'],
): Promise<Inserted | Reason> {
  const failedRun = await lockRun(tx, runId);
  if (!failedRun) return reason('run_not_found', { runId });
  // A trial leaves the PR untouched and its run B reads a draft linked by run id (S-22-T6): a
  // retry would write the PR timeline and read the active version, so a trial is started again.
  if (failedRun.kind === 'trial') return reason('run_not_retryable', { kind: failedRun.kind });
  const executions = await stageExecutionsOfRun(tx, runId);
  const transition = retryFromStage(runStateOf(failedRun, executions));
  if (!transition.ok) return transition.reason;
  const fromStage = transition.run.stages.find((s) => s.status === 'pending')?.key;
  if (!fromStage) return reason('no_stage_left');

  const run = await insertRun(tx, {
    pullRequestId: failedRun.pullRequestId,
    kind: failedRun.kind,
    roundNo: failedRun.roundNo,
    chainId: failedRun.chainId,
    level: failedRun.level,
    headSha: failedRun.headSha,
    commitsCountAtStart: failedRun.commitsCountAtStart,
    status: 'queued',
    startedBy: startedBy.kind,
    startedByMemberId: startedBy.kind === 'member' ? startedBy.memberId : null,
    trigger: failedRun.trigger,
    notChecked: failedRun.notChecked,
    retryOf: failedRun.id,
    retryFrom: fromStage,
  });

  for (const stage of transition.run.stages.filter((s) => s.status === 'reused')) {
    const source = latestAttempt(executions, stage.key)!;
    await insertStageExecution(tx, {
      runId: run.id,
      stage: stage.key,
      attempt: 1,
      status: 'reused',
      startedAt: source.startedAt,
      finishedAt: source.finishedAt,
      output: source.output,
      reusedFromStageId: source.id,
    });
  }
  // A failed stage writes nothing but its sessions, so all the failed run wrote came from the
  // stages it finished.
  await copyRunResults(tx, failedRun.id, run.id);
  await inTransaction?.(tx, run, failedRun, fromStage);
  return { run, failedRun, fromStage };
}

/** A row as a new row of another run: no id, a new creation time. */
function copyFor<T extends { id: number; createdAt: Date; runId: number }>(
  row: T,
  runId: number,
): Omit<T, 'id' | 'createdAt'> {
  const copy: Partial<T> = { ...row, runId };
  delete copy.id;
  delete copy.createdAt;
  return copy as Omit<T, 'id' | 'createdAt'>;
}

async function copyRunResults(tx: Executor, fromRunId: number, toRunId: number): Promise<void> {
  const ownFindings = await tx
    .select()
    .from(findings)
    .where(eq(findings.runId, fromRunId))
    .orderBy(asc(findings.ordinal));
  if (ownFindings.length) {
    await tx.insert(findings).values(ownFindings.map((row) => copyFor(row, toRunId)));
  }
  const ownQuestions = await tx
    .select()
    .from(questions)
    .where(eq(questions.runId, fromRunId))
    .orderBy(asc(questions.ordinal));
  if (ownQuestions.length) {
    await tx.insert(questions).values(ownQuestions.map((row) => copyFor(row, toRunId)));
  }
  const checks = await tx
    .select()
    .from(findingFixChecks)
    .where(eq(findingFixChecks.runId, fromRunId));
  if (checks.length) {
    await tx.insert(findingFixChecks).values(checks.map((row) => copyFor(row, toRunId)));
  }
}
