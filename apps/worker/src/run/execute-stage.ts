// The `run.stage` job (S-01-T10): starts one stage of one run, runs its executor, stores the
// result in one transaction, then queues the next stage or ends the run. Keyed by (runId, stage):
// a job for a stage that is not the run's next pending one does nothing.
import {
  completeStage,
  failStage,
  invalidRunModel,
  nextStage,
  startRun,
  startStage,
  type RunStageKey,
  type RunState,
  type Transition,
} from '@pra/core';
import {
  addRunCost,
  getRunContext,
  insertAgentSession,
  insertFindings,
  insertQuestions,
  saveFixChecks,
  activeInstructions,
  insertStageExecution,
  lockRun,
  stageExecutionsOfRun,
  updateAgentSession,
  updateRun,
  updateStageExecution,
  type Executor,
  type Transactor,
  type PullRequest,
  type QueueJob,
  type Repository,
  type Run,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import type { SessionRecord, StageError, StageExecutor, StageResult } from '../stages/stage.ts';
import { removeRunFiles } from './cleanup.ts';
import { passGates } from './gates.ts';
import { fireHooks, type RunHookContext } from './hooks.ts';
import { interruptRunningStage } from './interrupt.ts';
import { sendStageJob } from './jobs.ts';
import { liveSessions, type LiveSessions } from './live-sessions.ts';
import { recordRunStarted } from './timeline-hooks.ts';
import { latestAttempt, runStateOf } from './state.ts';

/** After the timeout aborts a session, how long the executor gets to return its costs. */
export const ABORT_GRACE_MS = 30_000;

export async function handleRunStages(
  deps: WorkerDeps,
  jobs: QueueJob<'run.stage'>[],
): Promise<void> {
  for (const job of jobs) await executeStage(deps, job.data.runId, job.data.stage);
}

export type ExecuteStageOutcome =
  'run_not_found' | 'not_next' | 'waiting' | 'interrupted' | 'succeeded' | 'failed';

/** Runs one stage of one run. Returns what happened (for logs and tests). */
export async function executeStage(
  deps: WorkerDeps,
  runId: number,
  stage: string,
  options: { abortGraceMs?: number } = {},
): Promise<ExecuteStageOutcome> {
  const { db, logger } = deps;
  const found = await getRunContext(db, runId);
  if (!found) {
    logger.warn({ runId, stage }, 'run not found');
    return 'run_not_found';
  }
  const { pullRequest, repository } = found;
  const executor = deps.extensions.stageExecutors[stage];

  // The queue holds one queued or active job per run and stage, so a job that finds its stage
  // still running is a retry: the handler that started the attempt threw or its worker stopped.
  if (found.run.status === 'running') {
    const interrupted = await db.transaction((tx) => interruptIfLeftRunning(tx, runId, stage));
    if (interrupted) {
      logger.warn({ runId, stage }, 'stage left running by an earlier attempt: interrupted');
      const hookContext = { deps, run: interrupted.run, pullRequest, repository };
      await afterTransition(deps, hookContext, interrupted.state);
      return 'interrupted';
    }
  }

  // Gates read outside the transaction: they may be slow, and the start re-checks the state.
  if (found.run.status === 'queued') {
    const gate = await passGates(deps.extensions.runGates.beforeRoundStart, {
      deps,
      run: found.run,
      pullRequest,
      repository,
      stage,
    });
    if (!gate.start) {
      logger.info({ runId, stage, reason: gate.reason }, 'round waits');
      return 'waiting';
    }
  }
  if (executor?.usesAgent) {
    const gate = await passGates(deps.extensions.runGates.beforeSession, {
      deps,
      run: found.run,
      pullRequest,
      repository,
      stage,
    });
    if (!gate.start) {
      logger.info({ runId, stage, reason: gate.reason }, 'session waits');
      return 'waiting';
    }
  }

  const started = await db.transaction((tx) => startStageInTx(tx, runId, repository.id, stage));
  if ('next' in started) {
    // A repeated job for a finished stage: the send of the next stage's job may have been lost
    // (the handler threw after its commit). The queue drops it while one is queued or active.
    if (started.next) await sendStageJob(deps.queue, runId, started.next);
    return 'not_next';
  }
  const { run, executionId, attempt } = started;
  // Sessions get their row when they start and their cost per turn (S-03-T3).
  const live = liveSessions(deps, { runId, stageExecutionId: executionId });

  const result = await runExecutor({ ...deps, agentRunner: live.runner }, executor, {
    run,
    pullRequest,
    repository,
    stage,
    attempt,
    abortGraceMs: options.abortGraceMs ?? ABORT_GRACE_MS,
  });

  const stored = await storeResult(deps, {
    runId,
    stage,
    attempt,
    executionId,
    result,
    pullRequest,
    live,
  });
  if (!stored) {
    logger.warn({ runId, stage }, 'stage result dropped: the run changed while it ran');
    return result.status;
  }
  logger.info(
    {
      runId,
      stage,
      attempt,
      status: result.status,
      error: result.status === 'failed' ? result.error.code : undefined,
    },
    'stage finished',
  );

  const hookContext: RunHookContext = { deps, run: stored.run, pullRequest, repository };
  for (const [index, session] of result.sessions.entries()) {
    await fireHooks(
      deps.extensions.runHooks.sessionCostRecorded,
      { ...hookContext, stage, session, sessionId: stored.sessionIds[index]! },
      'sessionCostRecorded',
    );
  }
  await afterTransition(deps, hookContext, stored.state);
  return result.status;
}

/** Queues the next stage of a running run, or runs the end hooks and removes the run's files. */
export async function afterTransition(
  deps: WorkerDeps,
  context: RunHookContext,
  state: RunState,
): Promise<void> {
  const { run } = context;
  if (state.status === 'running') {
    const next = nextStage(state);
    if (next) await sendStageJob(deps.queue, run.id, next);
    return;
  }
  if (state.status === 'completed') {
    await fireHooks(deps.extensions.runHooks.runCompleted, context, 'runCompleted');
  } else if (state.status === 'failed') {
    await fireHooks(deps.extensions.runHooks.runFailed, context, 'runFailed');
  } else if (state.status === 'cancelled') {
    await fireHooks(deps.extensions.runHooks.runCancelled, context, 'runCancelled');
  }
  await removeRunFiles(deps, context.repository, run.id);
}

type Started = { run: Run; executionId: number; attempt: number };
/** Not started: the job's stage is not the run's next one; `next` is, if any. */
type NotStarted = { next: RunStageKey | null };

async function interruptIfLeftRunning(
  tx: Executor,
  runId: number,
  stage: string,
): Promise<{ run: Run; state: RunState } | null> {
  const run = await lockRun(tx, runId);
  if (!run || run.status !== 'running') return null;
  const executions = await stageExecutionsOfRun(tx, runId);
  if (latestAttempt(executions, stage)?.status !== 'running') return null;
  const state = await interruptRunningStage(tx, run, executions);
  return state ? { run: (await lockRun(tx, runId))!, state } : null;
}

async function startStageInTx(
  tx: Executor & Transactor,
  runId: number,
  repositoryId: number,
  stage: string,
): Promise<Started | NotStarted> {
  const notStarted: NotStarted = { next: null };
  let run = await lockRun(tx, runId);
  if (!run) return notStarted;
  let executions = await stageExecutionsOfRun(tx, runId);
  let state = runStateOf(run, executions);

  if (state.status === 'queued') {
    const begun = startRun(state);
    if (!begun.ok) return notStarted;
    state = begun.run;
    const now = new Date();
    // The instruction files this run reads, for Run detail (S-03-T5).
    const instructionVersions = (await activeInstructions(tx, repositoryId)).map((v) => ({
      id: v.id,
      scope: v.scope,
      fileKey: v.fileKey,
      version: v.version,
    }));
    const patch = {
      status: 'running' as const,
      startedAt: now,
      currentStage: stage,
      instructionVersions,
    };
    await updateRun(tx, runId, patch);
    run = { ...run, ...patch };
    await recordRunStarted(tx, run, now);
    // Stages this level turns off get a row, so the run's history is complete.
    for (const off of state.stages.filter((s) => s.status === 'off')) {
      if (latestAttempt(executions, off.key)) continue;
      await insertStageExecution(tx, {
        runId,
        stage: off.key,
        attempt: 1,
        status: 'off',
        output: off.offReason ? { offReason: off.offReason } : null,
      });
    }
    executions = await stageExecutionsOfRun(tx, runId);
  }

  const next = nextStage(state);
  if (next !== stage) return { next };
  const transition = startStage(state, stage as RunStageKey);
  if (!transition.ok) return notStarted;

  const attempt = (latestAttempt(executions, stage)?.attempt ?? 0) + 1;
  const execution = await insertStageExecution(tx, {
    runId,
    stage,
    attempt,
    status: 'running',
    startedAt: new Date(),
  });
  if (run.currentStage !== stage) {
    await updateRun(tx, runId, { currentStage: stage });
    run = { ...run, currentStage: stage };
  }
  return { run, executionId: execution.id, attempt };
}

type RunInput = {
  run: Run;
  pullRequest: PullRequest;
  repository: Repository;
  stage: string;
  attempt: number;
  abortGraceMs: number;
};

const failed = (error: StageError, sessions: SessionRecord[] = []): StageResult => ({
  status: 'failed',
  error,
  sessions,
});

/** The executor's result, `stage_timeout` after the level's timeout, or the thrown error's code. */
async function runExecutor(
  deps: WorkerDeps,
  executor: StageExecutor | undefined,
  input: RunInput,
): Promise<StageResult> {
  if (!executor) return failed({ code: 'stage_not_available', params: { stage: input.stage } });
  // S-21-T2: a snapshot model that fails the model-name check fails the run before any spend.
  const badModel = invalidRunModel(input.run.models);
  if (badModel) return failed(badModel);

  const minutes = input.run.level.settings.stageTimeoutMinutes;
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  let graceTimer: NodeJS.Timeout | undefined;
  const timeout = { code: 'stage_timeout', params: { stage: input.stage, minutes } };

  const work = executor
    .run({
      deps,
      run: input.run,
      pullRequest: input.pullRequest,
      repository: input.repository,
      level: input.run.level,
      attempt: input.attempt,
      signal: controller.signal,
    })
    .catch((error: unknown): StageResult => {
      deps.logger.error({ err: error, runId: input.run.id, stage: input.stage }, 'stage threw');
      return failed(errorOf(error));
    });
  // After the timeout the session is aborted; the executor then has a short grace to return
  // the session (and its cost) before the stage fails without it.
  const expired = new Promise<StageResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('stage_timeout'));
      graceTimer = setTimeout(() => resolve(failed(timeout)), input.abortGraceMs);
    }, minutes * 60_000);
  });

  try {
    const result = await Promise.race([work, expired]);
    return timedOut ? failed(timeout, result.sessions) : result;
  } finally {
    clearTimeout(timer);
    clearTimeout(graceTimer);
  }
}

/** An integration error's code (`IntegrationError`, `SeedError`, ...), or `stage_error`. */
function errorOf(error: unknown): StageError {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const params = 'params' in error && error.params && typeof error.params === 'object';
    // Node's own errors (ENOENT, ...) carry a code too; only snake_case codes are ours.
    if (/^[a-z][a-z0-9_]*$/.test(error.code)) {
      return {
        code: error.code,
        params: params ? (error.params as Record<string, unknown>) : {},
      };
    }
  }
  return { code: 'stage_error', params: {} };
}

type BlobKeys = { prompt: string; transcript: string }[];

/** Prompt and transcript blobs, written before the rows that point at them. */
async function storeSessionBlobs(
  deps: WorkerDeps,
  runId: number,
  stage: string,
  attempt: number,
  sessions: readonly SessionRecord[],
): Promise<BlobKeys> {
  const keys: BlobKeys = [];
  for (const [index, session] of sessions.entries()) {
    const base = `runs/${runId}/${stage}-${attempt}/session-${index + 1}`;
    const key = { prompt: `${base}/prompt.txt`, transcript: `${base}/transcript.json` };
    await deps.blobStore.put(key.prompt, Buffer.from(session.prompt), {
      contentType: 'text/plain; charset=utf-8',
    });
    await deps.blobStore.put(
      key.transcript,
      Buffer.from(JSON.stringify(session.result.transcript)),
      {
        contentType: 'application/json',
      },
    );
    keys.push(key);
  }
  return keys;
}

type StoreInput = {
  runId: number;
  stage: string;
  executionId: number;
  result: StageResult;
  blobKeys: BlobKeys;
  pullRequest: PullRequest;
  live: Pick<LiveSessions, 'sessionIdOf'>;
};

type StoredResult = { run: Run; state: RunState; sessionIds: number[] };

/**
 * Blobs, then the stage transaction. When either throws (the blob store is down, the database
 * refuses a value), the stage fails `stage_error` with its sessions and their cost instead, so
 * the run does not stay running. Only when that fails too does the error reach pg-boss; its retry
 * then fails the attempt `interrupted`.
 */
async function storeResult(
  deps: WorkerDeps,
  input: Omit<StoreInput, 'blobKeys'> & { attempt: number },
): Promise<StoredResult | null> {
  const { runId, stage, attempt, result } = input;
  try {
    const blobKeys = await storeSessionBlobs(deps, runId, stage, attempt, result.sessions);
    return await deps.db.transaction((tx) => storeResultInTx(tx, { ...input, blobKeys }));
  } catch (error) {
    deps.logger.error({ err: error, runId, stage }, 'stage result could not be stored');
    const fallback = failed({ code: 'stage_error', params: {} }, result.sessions);
    return deps.db.transaction((tx) =>
      storeResultInTx(tx, { ...input, result: fallback, blobKeys: [] }),
    );
  }
}

async function storeResultInTx(
  tx: Executor,
  { runId, stage, executionId, result, blobKeys, pullRequest, live }: StoreInput,
): Promise<StoredResult | null> {
  const locked = await lockRun(tx, runId);
  if (!locked) return null;
  const state = runStateOf(locked, await stageExecutionsOfRun(tx, runId));

  // Sessions and their cost are recorded even when the run moved on (cost truth). Sessions run
  // through the live runner already have their row and cost; they only get their blob keys.
  const sessionIds: number[] = [];
  let unrecordedCost = 0;
  for (const [index, session] of result.sessions.entries()) {
    const { result: agent } = session;
    const liveId = live.sessionIdOf(agent);
    if (liveId !== undefined) {
      // No keys when the blobs could not be written (the stage then fails `stage_error`).
      const keys = blobKeys[index];
      if (keys) {
        await updateAgentSession(tx, liveId, {
          promptBlobKey: keys.prompt,
          transcriptBlobKey: keys.transcript,
        });
      }
      sessionIds.push(liveId);
      continue;
    }
    unrecordedCost += agent.costUsd;
    const row = await insertAgentSession(tx, {
      stageExecutionId: executionId,
      role: session.role,
      model: session.model,
      inputTokens: agent.usage.inputTokens,
      outputTokens: agent.usage.outputTokens,
      cacheReadTokens: agent.usage.cacheReadTokens,
      cacheWriteTokens: agent.usage.cacheWriteTokens,
      costUsd: agent.costUsd,
      costSource: agent.costSource,
      turns: agent.turns,
      durationMs: Math.round(agent.durationMs),
      status: agent.status,
      // No keys when the blobs could not be written (the stage then fails `stage_error`).
      promptBlobKey: blobKeys[index]?.prompt ?? null,
      transcriptBlobKey: blobKeys[index]?.transcript ?? null,
    });
    sessionIds.push(row.id);
  }
  await addRunCost(tx, runId, unrecordedCost);

  const transition: Transition =
    result.status === 'succeeded'
      ? completeStage(state, stage as RunStageKey)
      : failStage(state, stage as RunStageKey, result.error.code);
  if (!transition.ok) return null;
  const next = transition.run;
  const now = new Date();

  if (result.status === 'succeeded') {
    if (result.findings.length) {
      await insertFindings(
        tx,
        result.findings.map((finding, index) => ({
          ...finding,
          runId,
          pullRequestId: pullRequest.id,
          ordinal: index + 1,
        })),
      );
    }
    if (result.questions.length) {
      await insertQuestions(
        tx,
        result.questions.map((question, index) => ({ ...question, runId, ordinal: index + 1 })),
      );
    }
    if (result.fixChecks?.length) await saveFixChecks(tx, runId, result.fixChecks);
    await updateStageExecution(tx, executionId, {
      status: 'succeeded',
      finishedAt: now,
      output: result.output ?? null,
    });
  } else {
    await updateStageExecution(tx, executionId, {
      status: 'failed',
      finishedAt: now,
      errorCode: result.error.code,
      errorDetail: JSON.stringify(result.error.params),
      output: result.output ?? null,
    });
  }

  const finished = next.status !== 'running';
  const patch: Partial<Run> = {
    status: next.status,
    currentStage: finished ? null : (nextStage(next) ?? null),
    ...(finished ? { finishedAt: now } : {}),
    ...(result.status === 'succeeded' && result.notChecked.length
      ? { notChecked: result.notChecked }
      : {}),
  };
  await updateRun(tx, runId, patch);
  const run = (await lockRun(tx, runId))!;
  return { run, state: next, sessionIds };
}
