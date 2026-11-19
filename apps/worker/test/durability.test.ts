// S-09-T6: nothing stuck after a restart (NFR Durability). The worker runs as a child process
// (`durability-worker.ts`) whose reviewer double blocks in Review; the test kills it with SIGKILL
// and starts it again. The stage then fails `interrupted_by_restart` (Retry is offered), no row
// stays running, the session keeps its partial cost, and a round queued before the kill starts.
import {
  closeDb,
  createDb,
  eq,
  getRun,
  insertRun,
  schema,
  upsertPullRequest,
  upsertRepository,
  type Repository,
  type Run,
} from '@pra/db';
import {
  aPullRequest,
  aRepositoryConfig,
  aRun,
  createTestDatabase,
  type TestDatabase,
} from '@pra/db/testing';
import { createGitFixture, type GitFixture } from '@pra/integrations/testing';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

const BOOTSTRAP = fileURLToPath(new URL('./durability-worker.ts', import.meta.url));

let database: TestDatabase;
let fixture: GitFixture;
let db: ReturnType<typeof createDb>;
let repository: Repository;
const dataDir = mkdtempSync(path.join(tmpdir(), 'pra-durability-'));
const children: ChildProcess[] = [];

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  db = createDb(database.url, { max: 2 });
  repository = await upsertRepository(db, aRepositoryConfig());
}, 30_000);

afterAll(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  await closeDb(db);
  await Promise.all([database?.drop(), fixture?.remove(), rm(dataDir, { recursive: true })]);
});

/** Starts the worker; its stderr is kept for a failure message. */
function startWorkerProcess(mode: 'block' | 'answer'): { child: ChildProcess; log: () => string } {
  let output = '';
  const child = spawn(process.execPath, [BOOTSTRAP], {
    env: {
      ...process.env,
      DATABASE_URL: database.url,
      DATA_DIR: dataDir,
      FIXTURE_DIR: fixture.dir,
      REPO_FULL_NAME: repository.githubFullName,
      MODE: mode,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  children.push(child);
  return { child, log: () => output };
}

const killed = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });

async function queuedRun(number: number): Promise<Run> {
  const { pullRequest } = await upsertPullRequest(
    db,
    aPullRequest(repository.id, { number, headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  return insertRun(db, aRun(pullRequest.id, { headSha: fixture.headSha }));
}

async function reviewOf(runId: number) {
  const rows = await db
    .select()
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.runId, runId));
  return rows.find((row) => row.stage === 'review');
}

async function sessionsOf(stageExecutionId: number) {
  return db
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.stageExecutionId, stageExecutionId));
}

test('a SIGKILL during Review leaves nothing running after the restart', async () => {
  const blocked = await queuedRun(1);
  const first = startWorkerProcess('block');

  // The reviewer reported its first turn and now blocks.
  await vi.waitFor(
    async () => {
      const review = await reviewOf(blocked.id);
      expect(review?.status, first.log()).toBe('running');
      const [session] = await sessionsOf(review!.id);
      expect(session?.costUsd).toBe(0.01);
    },
    { timeout: 30_000, interval: 200 },
  );
  // Queued while the worker is busy (one stage job at a time), so it has not started.
  const waiting = await queuedRun(2);
  await killed(first.child);
  expect(await getRun(db, waiting.id)).toMatchObject({ status: 'queued' });

  const second = startWorkerProcess('answer');
  await vi.waitFor(
    async () => {
      const review = await reviewOf(blocked.id);
      expect(review, second.log()).toMatchObject({
        status: 'failed',
        errorCode: 'interrupted_by_restart',
      });
      expect((await getRun(db, waiting.id))?.status).not.toBe('queued');
    },
    // A child worker starts slowly under `pnpm verify`'s parallel load.
    { timeout: 30_000, interval: 200 },
  );

  expect(await getRun(db, blocked.id)).toMatchObject({
    status: 'failed',
    currentStage: null,
    costUsd: 0.01,
  });
  const review = (await reviewOf(blocked.id))!;
  const [session] = await sessionsOf(review.id);
  expect(session).toMatchObject({ costUsd: 0.01 });
  expect(session?.status).not.toBe('running');
  // The round queued before the kill runs to its end; no row is left running.
  await vi.waitFor(async () => expect((await getRun(db, waiting.id))?.status).toBe('completed'), {
    timeout: 20_000,
    interval: 200,
  });
  const stillRunning = await db
    .select({ id: schema.stageExecutions.id })
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.status, 'running'));
  expect(stillRunning).toEqual([]);
  await killed(second.child);
}, 90_000);
