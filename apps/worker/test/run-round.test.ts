// S-01-T10: the `run.stage` handler with a real pg-boss worker. Own database: a worker on the
// shared test database would take other files' jobs.
import { createClaudeAgentRunner } from '@pra/agents';
import type { FakeAgentStep } from '@pra/agents/testing';
import { freezeLevel, resolveLevel, type LevelNumber, type LevelOverrides } from '@pra/core';
import {
  asc,
  eq,
  getGithubEvent,
  getRun,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  schema,
  upsertPullRequest,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { sendStageJob } from '../src/run/jobs.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { recoverRuns, resendLostJobs } from '../src/run/recover.ts';
import { startRound } from '../src/run/start-round.ts';
import { startWorker, type RunningWorker } from '../src/worker.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let worker: RunningWorker;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  worker = await startWorker(deps, { pollingIntervalSeconds: 0.5 });
}, 30_000);

afterAll(async () => {
  await worker?.stop();
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

const finding = (severity: 'blocker' | 'should' | 'nit', n: number) => ({
  title: `${severity} ${n}`,
  severity,
  file: 'apps/demo/src/edges.ts',
  line: n,
  scenario: 'When the label is empty, the edge shows nothing.',
  suggestion: 'Fall back to the edge id.',
});

const ANSWER = {
  summary: 'Adds inline renaming.',
  risk: 'low',
  findings: [finding('should', 1), finding('blocker', 2)],
  questions: [{ question: 'Trim labels?', options: ['Yes', 'No'], recommended: 0, why: 'UX.' }],
  notChecked: ['Keyboard focus'],
};

/** A PR on a new repository with a queued round 1, through `startRound`. */
async function queueRound(level: LevelNumber = 1): Promise<Run> {
  const repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  const started = await startRound(deps, {
    pullRequestId: pullRequest.id,
    level,
    trigger: 'ready_for_review',
    startedBy: { kind: 'bot' },
  });
  if (!started.started) throw new Error(started.reason.code);
  return started.run;
}

/** A queued run with a custom frozen level, inserted directly, plus its first stage job. */
async function queueRunWith(overrides: LevelOverrides, level: LevelNumber = 1): Promise<Run> {
  const repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  const run = await insertRun(
    deps.db,
    aRun(pullRequest.id, {
      headSha: fixture.headSha,
      level: freezeLevel(resolveLevel(level, overrides)),
    }),
  );
  await sendStageJob(deps.queue, run.id, 'review');
  return run;
}

async function settled(runId: number): Promise<Run> {
  return vi.waitFor(
    async () => {
      const run = await getRun(deps.db, runId);
      if (!run || run.status === 'queued' || run.status === 'running') {
        throw new Error(`run ${runId} is ${run?.status}`);
      }
      return run;
    },
    { timeout: 20_000, interval: 100 },
  );
}

const stagesOf = (runId: number) =>
  deps.db
    .select()
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.runId, runId))
    .orderBy(asc(schema.stageExecutions.id));

async function sessionsOf(runId: number) {
  return deps.db
    .select({ session: schema.agentSessions })
    .from(schema.agentSessions)
    .innerJoin(
      schema.stageExecutions,
      eq(schema.stageExecutions.id, schema.agentSessions.stageExecutionId),
    )
    .where(eq(schema.stageExecutions.runId, runId))
    .then((rows) => rows.map((row) => row.session));
}

describe('run.stage', () => {
  test('a queued level-1 run completes with Review succeeded and the rest off', async () => {
    deps.agentRunner.enqueue({ output: ANSWER, costUsd: 0.37, turns: 4 });
    const run = await queueRunWith({ 1: { maxQuestions: 2 } });

    const done = await settled(run.id);

    expect(done.status).toBe('completed');
    expect(done.costUsd).toBeCloseTo(0.37);
    expect(done.notChecked).toEqual(['Keyboard focus']);
    expect(done.startedAt).toBeInstanceOf(Date);
    expect(done.finishedAt).toBeInstanceOf(Date);
    const stages = Object.fromEntries((await stagesOf(run.id)).map((s) => [s.stage, s.status]));
    expect(stages).toEqual({
      checks: 'off',
      task: 'off',
      change_type: 'off',
      verify: 'off',
      review: 'succeeded',
    });

    const findings = await deps.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.runId, run.id))
      .orderBy(asc(schema.findings.ordinal));
    expect(findings.map((f) => [f.ordinal, f.severity, f.verdict])).toEqual([
      [1, 'blocking', 'unchecked'],
      [2, 'worth_fixing', 'unchecked'],
    ]);
    const questions = await deps.db
      .select()
      .from(schema.questions)
      .where(eq(schema.questions.runId, run.id));
    expect(questions).toEqual([
      expect.objectContaining({ ordinal: 1, text: 'Trim labels?', options: ['Yes', 'No'] }),
    ]);

    const [session, ...more] = await sessionsOf(run.id);
    expect(more).toEqual([]);
    expect(session).toMatchObject({
      role: 'reviewer',
      model: 'claude-opus-5-5',
      costUsd: 0.37,
      costSource: 'reported',
      turns: 4,
      status: 'completed',
    });
    const transcript = await deps.blobStore.get(session!.transcriptBlobKey!);
    expect(JSON.parse(Buffer.from(transcript!.body).toString('utf8'))).toEqual([
      expect.objectContaining({ role: 'reviewer' }),
    ]);
    const prompt = await deps.blobStore.get(session!.promptBlobKey!);
    expect(Buffer.from(prompt!.body).toString('utf8')).toContain('brief.md');

    // After the commit: the one GitHub sentence, and the run's files are removed.
    await vi.waitFor(async () => {
      const actions = await deps.db
        .select()
        .from(schema.githubActions)
        .where(eq(schema.githubActions.runId, run.id));
      expect(actions).toEqual([
        expect.objectContaining({
          body: 'Ready for team member review (round 1)',
          result: 'posted',
        }),
      ]);
    });
    await vi.waitFor(() => {
      expect(existsSync(path.join(deps.dataDir, 'git', 'worktrees', `run-${run.id}`))).toBe(false);
      expect(existsSync(path.join(deps.dataDir, 'sessions', `run-${run.id}`))).toBe(false);
    });
  });

  test('a failing runner fails the run with its code and cost, and the next run completes', async () => {
    deps.agentRunner.enqueue({ fail: 'cost_limit_reached', costUsd: 10.02, turns: 31 });
    const failing = await queueRound();

    const failed = await settled(failing.id);

    expect(failed.status).toBe('failed');
    expect(failed.costUsd).toBeCloseTo(10.02);
    const [review] = (await stagesOf(failing.id)).filter((s) => s.stage === 'review');
    expect(review).toMatchObject({ status: 'failed', errorCode: 'cost_limit_reached' });
    expect(await sessionsOf(failing.id)).toEqual([
      expect.objectContaining({ costUsd: 10.02, status: 'failed' }),
    ]);

    deps.agentRunner.enqueue({ output: ANSWER });
    const next = await queueRound();
    expect((await settled(next.id)).status).toBe('completed');
  });

  test('a thrown error fails the stage with stage_error, and the next run still starts (P control 176)', async () => {
    deps.agentRunner.enqueue(() => {
      throw new Error('boom');
    });
    const throwing = await queueRound();

    expect((await settled(throwing.id)).status).toBe('failed');
    const [review] = (await stagesOf(throwing.id)).filter((s) => s.stage === 'review');
    expect(review).toMatchObject({ status: 'failed', errorCode: 'stage_error' });

    deps.agentRunner.enqueue({ output: ANSWER });
    const next = await queueRound();
    expect((await settled(next.id)).status).toBe('completed');
  });

  test('a result that cannot be stored fails the stage with stage_error and keeps the cost', async () => {
    deps.agentRunner.enqueue({ output: ANSWER, costUsd: 0.75 });
    const store = deps.blobStore;
    const put = store.put.bind(store);
    store.put = () => {
      store.put = put;
      return Promise.reject(new Error('blob store is down'));
    };
    const run = await queueRound();

    const ended = await settled(run.id);

    expect(ended.status).toBe('failed');
    expect(ended.costUsd).toBeCloseTo(0.75);
    const [review] = (await stagesOf(run.id)).filter((s) => s.stage === 'review');
    expect(review).toMatchObject({ status: 'failed', errorCode: 'stage_error' });
    expect(await sessionsOf(run.id)).toEqual([
      expect.objectContaining({ costUsd: 0.75, promptBlobKey: null }),
    ]);
  });

  test('a job that finds its stage still running fails it interrupted', async () => {
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id));
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { status: 'running', startedAt: new Date(), currentStage: 'review' }),
    );
    const execution = await insertStageExecution(deps.db, {
      runId: run.id,
      stage: 'review',
      attempt: 1,
      status: 'running',
      startedAt: new Date(),
    });
    // The live runner's row of the session the lost attempt started (S-03-T3).
    await insertAgentSession(deps.db, {
      stageExecutionId: execution.id,
      role: 'reviewer',
      model: 'claude-test',
      costUsd: 0.25,
      costSource: 'reported',
      status: 'running',
    });

    expect(await executeStage(deps, run.id, 'review')).toBe('interrupted');

    expect(await getRun(deps.db, run.id)).toMatchObject({ status: 'failed', currentStage: null });
    const [review] = await stagesOf(run.id);
    expect(review).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    const sessions = await deps.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.stageExecutionId, execution.id));
    expect(sessions).toEqual([expect.objectContaining({ status: 'interrupted', costUsd: 0.25 })]);
  });

  test('a repeated job for a finished stage sends the next stage job again', async () => {
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id));
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, {
        status: 'running',
        startedAt: new Date(),
        level: freezeLevel(resolveLevel(3)),
      }),
    );
    for (const stage of ['checks', 'task', 'change_type', 'review']) {
      await insertStageExecution(deps.db, {
        runId: run.id,
        stage,
        attempt: 1,
        status: 'succeeded',
      });
    }

    expect(await executeStage(deps, run.id, 'review')).toBe('not_next');

    // The worker takes the job; Verify runs and stops, since this test seeds no verifier
    // instructions.
    expect((await settled(run.id)).status).toBe('failed');
    const verify = (await stagesOf(run.id)).find((s) => s.stage === 'verify');
    expect(verify).toMatchObject({ status: 'failed', errorCode: 'verifier_instructions_missing' });
  });

  test('a round whose Verify has no instruction files fails at its first stage, before any session', async () => {
    const calls = deps.agentRunner.calls.length;
    const run = await queueRound(3);

    expect((await settled(run.id)).status).toBe('failed');
    const stages = await stagesOf(run.id);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      stage: 'checks',
      status: 'failed',
      errorCode: 'instructions_missing',
    });
    expect(JSON.parse(stages[0]!.errorDetail!)).toMatchObject({
      stage: 'verify',
      missing: ['prompt-verifier.md', 'verify-rules.md'],
    });
    expect(await sessionsOf(run.id)).toEqual([]);
    expect(deps.agentRunner.calls).toHaveLength(calls);
  });

  test('with the real adapter and no key the run fails with model_access_not_configured', async () => {
    const claude = createClaudeAgentRunner({});
    deps.agentRunner.enqueue((input) => claude.run(input));
    const run = await queueRound();

    expect((await settled(run.id)).status).toBe('failed');
    const [review] = (await stagesOf(run.id)).filter((s) => s.stage === 'review');
    expect(review).toMatchObject({ errorCode: 'model_access_not_configured' });
  });

  test('the level’s stage timeout aborts the session and fails with stage_timeout', async () => {
    // Under load the timeout can fire before the session starts; the step then ends at once.
    const waitForAbort: FakeAgentStep = (input) =>
      new Promise((resolve) => {
        const end = () =>
          resolve({
            status: 'cancelled',
            output: null,
            error: { code: 'cancelled', params: {} },
            usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
            costUsd: 0.05,
            costSource: 'computed',
            turns: 2,
            durationMs: 180,
            transcript: [],
          });
        if (input.signal!.aborted) end();
        else input.signal!.addEventListener('abort', end);
      });
    deps.agentRunner.enqueue(waitForAbort);
    // 3 s: long enough for git under load, so the session is running when the timeout fires.
    const run = await queueRunWith({ 1: { stageTimeoutMinutes: 0.05 } });

    expect((await settled(run.id)).status).toBe('failed');
    const [review] = (await stagesOf(run.id)).filter((s) => s.stage === 'review');
    expect(review).toMatchObject({ status: 'failed', errorCode: 'stage_timeout' });
    expect(await sessionsOf(run.id)).toEqual([
      expect.objectContaining({ costUsd: 0.05, costSource: 'computed', status: 'cancelled' }),
    ]);
  });

  test('a stage without an executor fails with stage_not_available', async () => {
    // Inserted without a stage job, and run directly on deps without a Checks executor.
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(
      deps.db,
      aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
    );
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
    );
    const withoutChecks = Object.fromEntries(
      Object.entries(deps.extensions.stageExecutors).filter(([key]) => key !== 'checks'),
    );

    const outcome = await executeStage(
      { ...deps, extensions: { ...deps.extensions, stageExecutors: withoutChecks } },
      run.id,
      'checks',
    );

    expect(outcome).toBe('failed');
    expect((await getRun(deps.db, run.id))!.status).toBe('failed');
    const stages = await stagesOf(run.id);
    expect(stages.find((s) => s.stage === 'checks')).toMatchObject({
      status: 'failed',
      errorCode: 'stage_not_available',
    });
    expect(stages.some((s) => s.stage === 'review')).toBe(false);
  });
});

describe('restart', () => {
  test('a stage left running becomes failed interrupted', async () => {
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id));
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { status: 'running', startedAt: new Date() }),
    );
    await insertStageExecution(deps.db, {
      runId: run.id,
      stage: 'review',
      attempt: 1,
      status: 'running',
      startedAt: new Date(),
    });

    const recovered = await recoverRuns(deps);

    expect(recovered.interrupted).toContain(run.id);
    expect(await getRun(deps.db, run.id)).toMatchObject({ status: 'failed' });
    const [review] = await stagesOf(run.id);
    expect(review).toMatchObject({ status: 'failed', errorCode: 'interrupted_by_restart' });
  });

  test(
    'a queued run whose job was lost gets its first stage job again',
    { timeout: 30_000 },
    async () => {
      const repository = await connectRepository(deps.db);
      const { pullRequest } = await upsertPullRequest(
        deps.db,
        aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
      );
      const run = await insertRun(deps.db, aRun(pullRequest.id, { headSha: fixture.headSha }));
      deps.agentRunner.enqueue({ output: ANSWER });

      const recovered = await recoverRuns(deps);

      expect(recovered.resent).toContain(run.id);
      expect((await settled(run.id)).status).toBe('completed');
    },
  );

  test('a stored event whose job was never sent is processed after the resend', async () => {
    const repository = await connectRepository(deps.db);
    const event = await storeGithubEvent(deps, 'ping', { fullName: repository.githubFullName });
    // The api wrote the row two minutes ago, then its send failed.
    await deps.db
      .update(schema.githubEvents)
      .set({ receivedAt: new Date(Date.now() - 120_000) })
      .where(eq(schema.githubEvents.id, event.id));

    expect((await resendLostJobs(deps)).events).toContain(event.id);

    await vi.waitFor(
      async () => expect((await getGithubEvent(deps.db, event.id))?.processedAt).not.toBeNull(),
      { timeout: 20_000, interval: 100 },
    );
  });
});
