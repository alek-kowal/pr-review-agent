// S-21-T2: the worker snapshots the level settings and every role's model when a run is created.
import type { FakeAgentStep } from '@pra/agents/testing';
import { DEFAULT_APP_SETTINGS, type LevelNumber } from '@pra/core';
import {
  asc,
  eq,
  getRun,
  importInstructionV1,
  schema,
  upsertPullRequest,
  writeAppSettings,
  writeLevelSettings,
  writeRoleModels,
  type Run,
} from '@pra/db';
import { aPullRequest, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { startRound } from '../src/run/start-round.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

// Its own database: model and level settings are global.
let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

const FILE = 'apps/demo/src/edges.ts';
const FOUND = 'export const label = (edge: { name: string }) => edge.name.trim();';

const reviewAnswer = {
  summary: 's',
  risk: 'low',
  findings: [
    {
      title: 'Finding 1',
      severity: 'blocker',
      file: FILE,
      line: 1,
      scenario: 'When the name is empty, the edge shows nothing.',
      suggestion: 'Fall back to the edge id.',
    },
  ],
  questions: [],
  notChecked: [],
};
const verifierAnswer = {
  output: {
    verdict: 'confirmed',
    reason: 'Read the code.',
    evidence: [{ file: FILE, line: 1, quote: FOUND }],
    remedy: { kind: 'obvious', why: 'Trim and fall back.' },
  },
};

/** A new repository (with verifier instructions) and a PR with a round through `startRound`. */
async function startedRound(options: { level?: LevelNumber; repoLevel?: LevelNumber | null }) {
  const repository = await connectRepository(deps.db, { defaultLevel: options.repoLevel ?? null });
  for (const [fileKey, content] of [
    ['prompt-verifier.md', 'Try to refute the finding.'],
    ['verify-rules.md', '# Script'],
  ] as const) {
    await importInstructionV1(deps.db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey,
      content,
    });
  }
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  const started = await startRound(deps, {
    pullRequestId: pullRequest.id,
    ...(options.level ? { level: options.level } : {}),
    trigger: 'manual',
    startedBy: { kind: 'bot' },
  });
  if (!started.started) throw new Error(started.reason.code);
  return started.run;
}

/** Runs the stages before Verify; the run is running afterwards. */
async function throughReview(run: Run) {
  for (const stage of ['checks', 'task', 'change_type']) {
    expect(await executeStage(deps, run.id, stage)).toBe('succeeded');
  }
  deps.agentRunner.enqueue({ output: reviewAnswer });
  expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');
}

const verifierModels = () =>
  deps.agentRunner.calls.filter((call) => call.role === 'verifier').map((call) => call.model);

const stageRow = async (runId: number, stage: string) =>
  (
    await deps.db
      .select()
      .from(schema.stageExecutions)
      .where(eq(schema.stageExecutions.runId, runId))
      .orderBy(asc(schema.stageExecutions.id))
  ).find((row) => row.stage === stage);

describe('run settings snapshot (S-21-T2)', () => {
  test('after the verifier model changes, a new run gets it and a running run keeps the old one', async () => {
    const running = await startedRound({ level: 3 });
    await throughReview(running);
    expect((await getRun(deps.db, running.id))!.status).toBe('running');

    await writeRoleModels(deps.db, { verifier: 'claude-haiku-5-5' });
    const next = await startedRound({ level: 3 });
    expect(next.models.verifier).toEqual({
      model: 'claude-haiku-5-5',
      source: 'settings',
      level: null,
    });
    await throughReview(next);

    deps.agentRunner.calls.length = 0;
    deps.agentRunner.enqueue(verifierAnswer);
    await executeStage(deps, running.id, 'verify');
    deps.agentRunner.enqueue(verifierAnswer);
    await executeStage(deps, next.id, 'verify');
    expect(verifierModels()).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);

    await writeRoleModels(deps.db, { verifier: 'claude-sonnet-5-5' });
  });

  test('a level 3 timeout override times out the review stage at the new value', async () => {
    await writeLevelSettings(deps.db, 3, { stageTimeoutMinutes: 7 });
    const run = await startedRound({ level: 4 });
    expect(run.level.settings.stageTimeoutMinutes).toBe(7);
    expect(run.level.origins.settings.stageTimeoutMinutes).toEqual({
      level: 3,
      source: 'override',
    });
    for (const stage of ['checks', 'task', 'change_type']) {
      expect(await executeStage(deps, run.id, stage)).toBe('succeeded');
    }

    let sessionStarted!: () => void;
    const started = new Promise<void>((resolve) => (sessionStarted = resolve));
    const waitForAbort: FakeAgentStep = (input) =>
      new Promise((resolve) => {
        sessionStarted();
        input.signal!.addEventListener('abort', () =>
          resolve({
            status: 'cancelled',
            output: null,
            error: { code: 'cancelled', params: {} },
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            costUsd: 0.01,
            costSource: 'computed',
            turns: 1,
            durationMs: 10,
            transcript: [],
          }),
        );
      });
    deps.agentRunner.calls.length = 0;
    deps.agentRunner.enqueue(waitForAbort);
    // Fake timers that also move with real time, so the database and git keep working; the
    // test then jumps the clock by the override, well short of the 30-minute default.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const outcome = executeStage(deps, run.id, 'review');
      await started;
      expect(deps.agentRunner.calls[0]).toMatchObject({ role: 'reviewer', timeoutMs: 7 * 60_000 });
      await vi.advanceTimersByTimeAsync(7 * 60_000 + 30_000);
      expect(await outcome).toBe('failed');
    } finally {
      vi.useRealTimers();
      await writeLevelSettings(deps.db, 3, {});
    }
    expect(await stageRow(run.id, 'review')).toMatchObject({
      status: 'failed',
      errorCode: 'stage_timeout',
    });
  });

  test('a repository without its own level starts at the global default', async () => {
    await writeAppSettings(deps.db, { ...DEFAULT_APP_SETTINGS, defaultLevel: 2 });
    try {
      const run = await startedRound({});
      expect(run.level.number).toBe(2);
      const own = await startedRound({ repoLevel: 5 });
      expect(own.level.number).toBe(5);
    } finally {
      await writeAppSettings(deps.db, DEFAULT_APP_SETTINGS);
    }
  });

  test('an invalid model fails the run with the reason before any spend', async () => {
    await writeRoleModels(deps.db, { judge: 'bad name' });
    try {
      const run = await startedRound({ level: 2 });
      deps.agentRunner.calls.length = 0;
      expect(await executeStage(deps, run.id, 'checks')).toBe('failed');
      expect((await getRun(deps.db, run.id))!.status).toBe('failed');
      expect(await stageRow(run.id, 'checks')).toMatchObject({ errorCode: 'model_invalid' });
      expect(deps.agentRunner.calls).toEqual([]);
    } finally {
      await writeRoleModels(deps.db, { judge: 'claude-haiku-5-5' });
    }
  });
});
