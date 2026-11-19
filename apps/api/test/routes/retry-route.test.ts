// S-09-T2: Retry a failed round from its failed stage, by hand. The retry is a new run for the
// same round; stages the failed run finished show as reused, and Run detail links both runs.
import {
  closeDb,
  createDb,
  createQueue,
  eq,
  insertRun,
  insertStageExecution,
  schema,
  stageExecutionsOfRun,
  timelineOf,
  upsertRepository,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aRepositoryConfig, aRun, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { RetryRunResponse, RunDetailResponse } from '../../src/routes/api/runs/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
// Sends need a started pg-boss instance; no worker takes the jobs.
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});

let app: FastifyInstance;
let repository: Repository;

beforeAll(async () => {
  await queue.start();
  repository = await upsertRepository(db, aRepositoryConfig({ slug: 'retry-route' }));
});
afterAll(async () => {
  await queue.stop({ graceful: false }).catch(() => {});
  await closeDb(db);
});
beforeEach(async () => {
  app = await build({ db, queue });
});

const retry = (runId: number, headers: Record<string, string> = SAME_ORIGIN) =>
  app.inject({ method: 'POST', url: `/api/runs/${runId}/retry`, headers });

async function runDetail(runId: number) {
  const response = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  expect(response.statusCode).toBe(200);
  return RunDetailResponse.parse(response.json());
}

/** A level-3 round 1 that finished Checks, Task and Change type and timed out in Review. */
async function seedFailedRound(pullRequest: PullRequest): Promise<Run> {
  const failed = await insertRun(
    db,
    aRun(pullRequest.id, {
      levelNumber: 3,
      headSha: pullRequest.headSha,
      commitsCountAtStart: pullRequest.commitsCount,
      status: 'failed',
      costUsd: 0.42,
    }),
  );
  const finished = { attempt: 1, startedAt: new Date(), finishedAt: new Date() };
  for (const stage of ['checks', 'task', 'change_type']) {
    await insertStageExecution(db, {
      runId: failed.id,
      stage,
      status: 'succeeded',
      output: { stage },
      ...finished,
    });
  }
  await insertStageExecution(db, {
    runId: failed.id,
    stage: 'review',
    status: 'failed',
    errorCode: 'stage_timeout',
    ...finished,
  });
  return failed;
}

describe('retry a failed round', () => {
  test('starts a new run from the failed stage, by hand, and reuses the finished stages', async () => {
    const pullRequest = await seedPr(db, repository.id);
    const failed = await seedFailedRound(pullRequest);

    const response = await retry(failed.id);

    expect(response.statusCode).toBe(201);
    const body = RetryRunResponse.parse(response.json());
    expect(body.run.fromStage).toBe('review');
    const [retried] = await db.select().from(schema.runs).where(eq(schema.runs.id, body.run.id));
    expect(retried).toMatchObject({
      status: 'queued',
      retryOf: failed.id,
      retryFrom: 'review',
      roundNo: failed.roundNo,
      startedBy: 'hand',
    });

    const stages = await stageExecutionsOfRun(db, body.run.id);
    expect(
      stages
        .filter((s) => s.status === 'reused')
        .map((s) => s.stage)
        .sort(),
    ).toEqual(['change_type', 'checks', 'task']);

    // "Retry from Review started by hand"
    const entries = await timelineOf(db, pullRequest.id);
    expect(entries.find((e) => e.kind === 'run_retried')).toMatchObject({
      actor: 'hand',
      runId: body.run.id,
      params: { stage: 'review', failedRunId: failed.id },
    });
  });

  test('Run detail marks reused stages and links the failed run with its cost', async () => {
    const pullRequest = await seedPr(db, repository.id);
    const failed = await seedFailedRound(pullRequest);
    const { run } = RetryRunResponse.parse((await retry(failed.id)).json());

    const detail = await runDetail(run.id);
    expect(detail.run.retryOf).toEqual({ id: failed.id, status: 'failed', costUsd: 0.42 });
    expect(detail.run.retryFrom).toBe('review');
    const reused = Object.fromEntries(detail.stages.map((s) => [s.key, s.reused]));
    expect(reused).toMatchObject({ checks: true, task: true, change_type: true, review: false });

    const failedDetail = await runDetail(failed.id);
    expect(failedDetail.run.retriedBy).toMatchObject({ id: run.id, status: 'queued' });
    expect(failedDetail.run.error).toEqual({ stage: 'review', code: 'stage_timeout' });
  });

  test('the PR banner offers no second retry while the retry is active', async () => {
    const pullRequest = await seedPr(db, repository.id);
    const failed = await seedFailedRound(pullRequest);
    expect((await retry(failed.id)).statusCode).toBe(201);

    const again = await retry(failed.id);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'run_active' } });
  });

  test('409 run_not_failed for a run that did not fail', async () => {
    const pullRequest = await seedPr(db, repository.id);
    const completed = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));

    const response = await retry(completed.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'run_not_failed', params: { status: 'completed' } },
    });
  });

  test('404 for an unknown run, 403 without the request header', async () => {
    expect((await retry(999_999)).statusCode).toBe(404);
    const pullRequest = await seedPr(db, repository.id);
    const failed = await seedFailedRound(pullRequest);
    expect((await retry(failed.id, {})).statusCode).toBe(403);
  });
});
