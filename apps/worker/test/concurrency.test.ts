// P-27: on a 1-vCPU host several runs are in flight at once (`WORKER_AGENT_CONCURRENCY`, stage jobs
// of different runs overlap) while sandbox containers take turns (`WORKER_SANDBOX_CONCURRENCY`).
// A real pg-boss worker on its own database: a worker on the shared one would take other jobs.
import { getRun, insertRun, upsertPullRequest, type Run } from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { ConfigValueError, DEFAULT_SANDBOX_PROFILE, LimitedSandbox } from '@pra/integrations';
import { FakeSandbox } from '@pra/integrations/testing';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { workerLimitsFromEnv } from '../src/limits.ts';
import { sendStageJob } from '../src/run/jobs.ts';
import { STAGE_EXECUTORS } from '../src/stages/index.ts';
import type { StageExecutor } from '../src/stages/stage.ts';
import { startWorker, type RunningWorker } from '../src/worker.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

describe('workerLimitsFromEnv', () => {
  test('defaults: three stages and one sandbox container at once, VPS-sized containers', () => {
    expect(workerLimitsFromEnv({})).toEqual({
      agentConcurrency: 3,
      sandboxConcurrency: 1,
      sandbox: DEFAULT_SANDBOX_PROFILE,
    });
  });

  test('both limits are configurable; a bad value names its variable', () => {
    const limits = workerLimitsFromEnv({
      WORKER_AGENT_CONCURRENCY: '5',
      WORKER_SANDBOX_CONCURRENCY: '2',
      SANDBOX_MEMORY_MB: '1024',
    });
    expect(limits).toMatchObject({ agentConcurrency: 5, sandboxConcurrency: 2 });
    expect(limits.sandbox.install.memoryMb).toBe(1024);
    for (const value of ['0', '2.5', 'many', '21']) {
      expect(() => workerLimitsFromEnv({ WORKER_AGENT_CONCURRENCY: value })).toThrow(
        ConfigValueError,
      );
    }
    expect(() => workerLimitsFromEnv({ WORKER_SANDBOX_CONCURRENCY: '0' })).toThrow(
      'WORKER_SANDBOX_CONCURRENCY',
    );
  });
});

describe('a worker with stage concurrency 3 and one sandbox', () => {
  let database: TestDatabase;
  let deps: TestWorkerDeps;
  let worker: RunningWorker;

  const stages = { active: 0, peak: 0, releases: [] as Array<() => void> };
  const containers = { active: 0, peak: 0 };
  const inner = new FakeSandbox(async () => {
    containers.active += 1;
    containers.peak = Math.max(containers.peak, containers.active);
    await new Promise((resolve) => setTimeout(resolve, 100));
    containers.active -= 1;
    return {};
  });

  /** Waits like a Claude session until the test lets it go, then runs one sandbox container. */
  const blockingReview: StageExecutor = {
    key: 'review',
    usesAgent: false,
    async run({ deps: stageDeps, signal }) {
      stages.active += 1;
      stages.peak = Math.max(stages.peak, stages.active);
      await new Promise<void>((resolve) => stages.releases.push(resolve));
      await stageDeps.sandbox.run({
        image: 'node:24-slim',
        command: ['true'],
        workdir: '/work',
        mounts: [],
        limits: stageDeps.sandboxProfile.repro,
        signal,
      });
      stages.active -= 1;
      return {
        status: 'failed',
        error: { code: 'stage_error', params: { test: 'stage_done' } },
        sessions: [],
      };
    },
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = await createTestWorkerDeps({
      url: database.url,
      extensions: { stageExecutors: { ...STAGE_EXECUTORS, review: blockingReview } },
    });
    worker = await startWorker(
      { ...deps, sandbox: new LimitedSandbox(inner, 1) },
      { pollingIntervalSeconds: 0.5, stageConcurrency: 3 },
    );
  }, 30_000);

  afterAll(async () => {
    for (const release of stages.releases.splice(0)) release();
    await worker?.stop();
    await deps?.close();
    await database?.drop();
  });

  async function queueRun(): Promise<Run> {
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id));
    const run = await insertRun(deps.db, aRun(pullRequest.id));
    await sendStageJob(deps.queue, run.id, 'review');
    return run;
  }

  test('three runs are in their stage at once; their containers run one after another', async () => {
    const runs = await Promise.all([queueRun(), queueRun(), queueRun()]);
    await vi.waitFor(() => expect(stages.active).toBe(3), { timeout: 15_000, interval: 50 });

    for (const release of stages.releases.splice(0)) release();
    await vi.waitFor(
      async () => {
        for (const run of runs) expect((await getRun(deps.db, run.id))?.status).toBe('failed');
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(stages.peak).toBe(3);
    expect(inner.calls).toHaveLength(3);
    expect(containers.peak).toBe(1);
  }, 40_000);
});
