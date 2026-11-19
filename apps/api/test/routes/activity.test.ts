// S-03-T7: Activity → In progress and the status chip. Own database: today's spend sums every
// session, so other files' sessions would change it.
import {
  closeDb,
  createDb,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  sql,
  type Db,
} from '@pra/db';
import { aRun, createTestDatabase, seedPullRequest, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { InProgressResponse } from '../../src/routes/api/activity/index.ts';
import { StatusResponse } from '../../src/routes/api/status/index.ts';
import { build } from '../helper.ts';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
}, 30_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.drop();
});

test('in progress lists queued and running runs with their stage and cost so far', async () => {
  const { repository, pullRequest } = await seedPullRequest(db);
  const other = await seedPullRequest(db, { pullRequest: { number: pullRequest.number + 1 } });
  const running = await insertRun(
    db,
    aRun(pullRequest.id, {
      status: 'running',
      startedAt: new Date(),
      currentStage: 'review',
      costUsd: 0.31,
    }),
  );
  const queued = await insertRun(db, aRun(other.pullRequest.id, { status: 'queued' }));
  await insertRun(db, aRun(pullRequest.id, { status: 'completed', costUsd: 2 }));

  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: '/api/activity/in-progress' });
  expect(response.statusCode).toBe(200);
  const body = InProgressResponse.parse(response.json());
  expect(body.runs.map((r) => [r.id, r.status, r.currentStage, r.costUsd])).toEqual([
    [running.id, 'running', 'review', 0.31],
    [queued.id, 'queued', null, 0],
  ]);
  expect(body.runs[0]!.pullRequest).toEqual({
    repository: { slug: repository.slug },
    number: pullRequest.number,
    title: pullRequest.title,
  });
});

test("the status is running with today's spend: sessions since 00:00 UTC", async () => {
  const { pullRequest } = await seedPullRequest(db, { pullRequest: { number: 900 } });
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));
  const stage = await insertStageExecution(db, {
    runId: run.id,
    stage: 'review',
    attempt: 1,
    status: 'succeeded',
  });
  const session = (costUsd: number) =>
    insertAgentSession(db, {
      stageExecutionId: stage.id,
      role: 'reviewer',
      model: 'claude-opus-5-5',
      costUsd,
      costSource: 'reported',
      status: 'completed',
    });
  const api = await build({ db });
  const before = StatusResponse.parse(
    (await api.inject({ method: 'GET', url: '/api/status' })).json(),
  );

  await session(0.4);
  await session(0.35);
  const yesterday = await session(5);
  await db.execute(
    sql`update agent_sessions set created_at = now() - interval '1 day' where id = ${yesterday.id}`,
  );

  const after = StatusResponse.parse(
    (await api.inject({ method: 'GET', url: '/api/status' })).json(),
  );
  expect(after.state).toBe('running');
  expect(after.todaySpendUsd - before.todaySpendUsd).toBeCloseTo(0.75, 6);
  expect(new Date(after.since).getUTCHours()).toBe(0);
});
