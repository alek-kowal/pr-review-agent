// S-03-T3: while a session runs, its cost and the run's current stage are stored turn by turn.
// Own database, and `executeStage` called directly: no worker takes the job.
import type { AgentProgress } from '@pra/agents';
import {
  eq,
  getRun,
  insertRun,
  schema,
  upsertPullRequest,
  type AgentSession,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

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

const ANSWER = {
  summary: 'Adds inline renaming.',
  risk: 'low',
  findings: [],
  questions: [],
  notChecked: [],
};

const turn = (turns: number, costUsd: number): AgentProgress => ({
  turns,
  costUsd,
  usage: {
    inputTokens: 1_000 * turns,
    outputTokens: 100 * turns,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
});

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

test('session cost grows after each turn, ends at the reported total, and the run names its stage', async () => {
  const run = await queuedRun();
  const turns = [turn(1, 0.01), turn(2, 0.025), turn(3, 0.04)];
  const seen: { session: number; run: number; stage: string | null; status: string }[] = [];

  deps.agentRunner.enqueue(async (input) => {
    for (const progress of turns) {
      input.onProgress!(progress);
      const session = await vi.waitFor(async () => {
        const [row] = await sessionsOf(run.id);
        expect(row?.costUsd).toBe(progress.costUsd);
        return row!;
      });
      const stored = (await getRun(deps.db, run.id))!;
      seen.push({
        session: session.costUsd,
        run: stored.costUsd,
        stage: stored.currentStage,
        status: session.status,
      });
    }
    return {
      status: 'completed',
      output: input.outputSchema.parse(ANSWER),
      error: null,
      usage: { inputTokens: 3_100, outputTokens: 320, cacheReadTokens: 50, cacheWriteTokens: 0 },
      costUsd: 0.0421,
      costSource: 'reported',
      turns: 3,
      durationMs: 1_234,
      transcript: [{ type: 'result' }],
    };
  });

  expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');

  expect(seen).toEqual([
    { session: 0.01, run: 0.01, stage: 'review', status: 'running' },
    { session: 0.025, run: 0.025, stage: 'review', status: 'running' },
    { session: 0.04, run: 0.04, stage: 'review', status: 'running' },
  ]);
  const [session] = await sessionsOf(run.id);
  expect(session).toMatchObject({
    costUsd: 0.0421,
    costSource: 'reported',
    status: 'completed',
    turns: 3,
    inputTokens: 3_100,
    durationMs: 1_234,
  });
  expect(session!.transcriptBlobKey).toMatch(/^runs\/\d+\/review-1\/session-1\/transcript\.json$/);
  // Level 1: Review is the last stage, so the run is done and names no stage.
  expect(await getRun(deps.db, run.id)).toMatchObject({
    status: 'completed',
    costUsd: 0.0421,
    currentStage: null,
  });
});

test('a session that throws keeps the cost of the turns it reported', async () => {
  const run = await queuedRun();
  deps.agentRunner.enqueue(async (input) => {
    input.onProgress!(turn(1, 0.02));
    await new Promise((resolve) => setTimeout(resolve, 50));
    throw new Error('connection reset');
  });

  expect(await executeStage(deps, run.id, 'review')).toBe('failed');

  const [session] = await sessionsOf(run.id);
  expect(session).toMatchObject({ costUsd: 0.02, status: 'failed' });
  expect(await getRun(deps.db, run.id)).toMatchObject({
    status: 'failed',
    costUsd: 0.02,
    currentStage: null,
  });
});
