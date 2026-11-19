// S-09-T3: cancel stops spend at once. A cancel request (as the api records it) reaches the worker
// on `pra_change`; the in-flight session is aborted, its cost so far stays, nothing else of the
// stage is written (not even when the double answers late), and the run's queued jobs are gone.
// Own database (the listener hears only it), and `executeStage` called directly.
import type { AgentProgress, AgentRunResult } from '@pra/agents';
import { HAND } from '@pra/core';
import {
  eq,
  getRun,
  insertRun,
  JOBS,
  requestRunCancel,
  schema,
  sendStageJob,
  stageExecutionsOfRun,
  timelineOf,
  upsertPullRequest,
  type AgentSession,
  type ChangeListener,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { listenForCancels } from '../src/run/cancel.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let listener: ChangeListener;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  listener = listenForCancels(deps);
  await listener.ready;
}, 30_000);

afterAll(async () => {
  await listener?.close();
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

const ANSWER = {
  summary: 'Adds inline renaming.',
  risk: 'low',
  findings: [],
  questions: [],
  notChecked: ['the e2e tests'],
};
/** What the whole session would have cost. */
const FULL_COST = 0.06;

const usage = (turns: number) => ({
  inputTokens: 1_000 * turns,
  outputTokens: 100 * turns,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
const turn = (turns: number, costUsd: number): AgentProgress => ({
  usage: usage(turns),
  costUsd,
  turns,
});

const BY_HAND = { actor: HAND, reason: 'by_hand' as const };

async function queuedRun(): Promise<Run> {
  const repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  return insertRun(deps.db, aRun(pullRequest.id, { headSha: fixture.headSha }));
}

async function sessionsOf(runId: number): Promise<AgentSession[]> {
  const rows = await deps.db
    .select({ session: schema.agentSessions })
    .from(schema.agentSessions)
    .innerJoin(
      schema.stageExecutions,
      eq(schema.stageExecutions.id, schema.agentSessions.stageExecutionId),
    )
    .where(eq(schema.stageExecutions.runId, runId));
  return rows.map((row) => row.session);
}

const reviewOf = async (runId: number) =>
  (await stageExecutionsOfRun(deps.db, runId)).find((e) => e.stage === 'review');
const sessionCost = async (runId: number) => (await sessionsOf(runId))[0]?.costUsd;
const queuedJobs = (runId: number) =>
  deps.queue.findJobs(JOBS.runStage, { data: { runId }, queued: true });

const abortOf = (signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) resolve();
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });

test('a cancel during turn 2 aborts the session within 1 s and keeps the cost of turns 1–2', async () => {
  const run = await queuedRun();
  let abortedAfterMs = -1;

  deps.agentRunner.enqueue(async (input): Promise<AgentRunResult<unknown>> => {
    input.onProgress!(turn(1, 0.01));
    input.onProgress!(turn(2, 0.025));
    await vi.waitFor(async () => expect(await sessionCost(run.id)).toBe(0.025));
    const asked = Date.now();
    await requestRunCancel(deps.db, run.id, BY_HAND);
    await abortOf(input.signal);
    abortedAfterMs = Date.now() - asked;
    return {
      status: 'cancelled',
      output: null,
      error: { code: 'cancelled', params: {} },
      usage: usage(2),
      costUsd: 0.025,
      costSource: 'computed',
      turns: 2,
      durationMs: 800,
      transcript: [],
    };
  });

  expect(await executeStage(deps, run.id, 'review')).toBe('cancelled');

  expect(abortedAfterMs).toBeGreaterThanOrEqual(0);
  expect(abortedAfterMs).toBeLessThan(1_000);
  const cost = await sessionCost(run.id);
  expect(cost).toBeGreaterThan(0);
  expect(cost).toBeLessThan(FULL_COST);
  expect(await getRun(deps.db, run.id)).toMatchObject({
    status: 'cancelled',
    costUsd: 0.025,
    currentStage: null,
    notChecked: [],
  });
  expect(await reviewOf(run.id)).toMatchObject({ status: 'failed', errorCode: 'cancelled' });
  // "Cancelled by hand · $0.03 spent" on the PR timeline.
  const entry = (await timelineOf(deps.db, run.pullRequestId)).find(
    (e) => e.kind === 'run_cancelled',
  );
  expect(entry).toMatchObject({ actor: 'hand', costUsd: 0.025, params: { reason: 'by_hand' } });
});

test('nothing of the stage is written after the cancel, even when the double answers late', async () => {
  const run = await queuedRun();
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let returned = false;

  deps.agentRunner.enqueue(async (input): Promise<AgentRunResult<unknown>> => {
    input.onProgress!(turn(1, 0.01));
    await vi.waitFor(async () => expect(await sessionCost(run.id)).toBe(0.01));
    await requestRunCancel(deps.db, run.id, BY_HAND);
    // This double ignores the abort and answers after the grace.
    await answered;
    returned = true;
    return {
      status: 'completed',
      output: input.outputSchema.parse(ANSWER),
      error: null,
      usage: usage(3),
      costUsd: FULL_COST,
      costSource: 'reported',
      turns: 3,
      durationMs: 5_000,
      transcript: [{ type: 'result' }],
    };
  });

  expect(await executeStage(deps, run.id, 'review', { cancelGraceMs: 100 })).toBe('cancelled');
  answer();
  await vi.waitFor(() => expect(returned).toBe(true));
  // The late session still updates its own cost row (money spent stays true), nothing else.
  await vi.waitFor(async () => expect(await sessionCost(run.id)).toBe(FULL_COST));

  const stored = await getRun(deps.db, run.id);
  expect(stored).toMatchObject({ status: 'cancelled', notChecked: [], costUsd: FULL_COST });
  expect(await reviewOf(run.id)).toMatchObject({
    status: 'failed',
    errorCode: 'cancelled',
    output: null,
  });
  const findings = await deps.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.runId, run.id));
  expect(findings).toEqual([]);
});

test('a cancelled queued run never calls AgentRunner and its stage jobs are gone', async () => {
  const run = await queuedRun();
  await sendStageJob(deps.queue, run.id, 'review', run);
  expect(await queuedJobs(run.id)).toHaveLength(1);
  const calls = deps.agentRunner.calls.length;

  expect(await requestRunCancel(deps.db, run.id, BY_HAND)).toMatchObject({ requested: true });

  // The listener finishes the cancel: nothing was in flight, so the run ends at once.
  await vi.waitFor(async () =>
    expect(await getRun(deps.db, run.id)).toMatchObject({ status: 'cancelled' }),
  );
  // The jobs are deleted right after the status commit.
  await vi.waitFor(async () => expect(await queuedJobs(run.id)).toHaveLength(0));
  // A stage job that slipped through does nothing.
  expect(['cancelled', 'not_next']).toContain(await executeStage(deps, run.id, 'review'));
  expect(deps.agentRunner.calls).toHaveLength(calls);
  expect(await stageExecutionsOfRun(deps.db, run.id)).toEqual([]);
});

test('a cancel of a finished run is refused', async () => {
  const run = await queuedRun();
  await deps.db.update(schema.runs).set({ status: 'completed' }).where(eq(schema.runs.id, run.id));

  expect(await requestRunCancel(deps.db, run.id, BY_HAND)).toEqual({
    requested: false,
    reason: { code: 'run_finished', params: { status: 'completed' } },
  });
});
