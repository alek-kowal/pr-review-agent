// S-16-T3: a fork PR starts by hand; its run, Run detail and the PR page's stepper carry the
// read-only policy (install and reproductions off for forks).
import {
  closeDb,
  createDb,
  createQueue,
  getRun,
  runPlanOf,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { StartReviewResponse } from '../../src/routes/api/rounds/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
// Sends need a started pg-boss instance; no worker takes the jobs.
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});

let app: FastifyInstance;
let repository: Repository;
let nextNumber = 900;

beforeAll(async () => {
  await queue.start();
  repository = await upsertRepository(db, aRepositoryConfig());
});
afterAll(async () => {
  await queue.stop({ graceful: false }).catch(() => {});
  await closeDb(db);
});
beforeEach(async () => {
  app = await build({ db, queue });
});

const FORK_READ_ONLY = { code: 'fork_read_only', params: {} };
const url = (pr: PullRequest, path = '') => `/api/prs/${repository.slug}/${pr.number}${path}`;
const seedFork = (isFork: boolean) =>
  seedPr(db, repository.id, { number: nextNumber++, isFork, isDraft: false });

async function start(pr: PullRequest, level: number) {
  const response = await app.inject({
    method: 'POST',
    url: url(pr, '/start-review'),
    headers: SAME_ORIGIN,
    payload: { level },
  });
  expect(response.statusCode).toBe(201);
  return StartReviewResponse.parse(response.json()).runId;
}

type StageLike = {
  key: string;
  status: string;
  offReason: unknown;
  offSteps: { step: string; reason: unknown }[];
};
const byKey = (stages: StageLike[]) => new Map(stages.map((stage) => [stage.key, stage]));

async function runStages(runId: number) {
  const response = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  expect(response.statusCode).toBe(200);
  return byKey(response.json().stages as StageLike[]);
}

async function stepperSteps(pr: PullRequest) {
  const response = await app.inject({ method: 'GET', url: url(pr) });
  expect(response.statusCode).toBe(200);
  return byKey(response.json().roundProgress.steps as StageLike[]);
}

describe('fork PR start and stages', () => {
  test('a manual start on a fork queues a round whose plan is read-only', async () => {
    const pr = await seedFork(true);
    const runId = await start(pr, 4);

    const run = await getRun(db, runId);
    expect(run).toMatchObject({ status: 'queued', trigger: 'manual', kind: 'round' });
    expect(runPlanOf(run!, pr).offSteps).toEqual([
      { stage: 'checks', step: 'install', reason: FORK_READ_ONLY },
      { stage: 'verify', step: 'reproductions', reason: FORK_READ_ONLY },
    ]);
  });

  test('Run detail and the stepper show install and reproductions off for forks', async () => {
    const pr = await seedFork(true);
    const runId = await start(pr, 4);

    for (const stages of [await runStages(runId), await stepperSteps(pr)]) {
      expect(stages.get('checks')?.offSteps).toEqual([{ step: 'install', reason: FORK_READ_ONLY }]);
      expect(stages.get('verify')?.offSteps).toEqual([
        { step: 'reproductions', reason: FORK_READ_ONLY },
      ]);
      expect(stages.get('review')?.offSteps).toEqual([]);
    }
  });

  test('a fork fix check shows its Reproductions stage off for forks', async () => {
    const pr = await seedFork(true);
    const { run } = await seedRound(db, pr, { run: { roundNo: 2, status: 'running' } });

    const reproductions = (await runStages(run.id)).get('reproductions');
    expect(reproductions).toMatchObject({ status: 'off', offReason: FORK_READ_ONLY });
    expect((await stepperSteps(pr)).get('reproductions')).toMatchObject({
      status: 'off',
      offReason: FORK_READ_ONLY,
    });
  });

  test('nothing is off for a PR from the same repository', async () => {
    const pr = await seedFork(false);
    const runId = await start(pr, 4);

    expect(runPlanOf((await getRun(db, runId))!, pr).offSteps).toEqual([]);
    for (const stage of (await runStages(runId)).values()) expect(stage.offSteps).toEqual([]);
    for (const stage of (await stepperSteps(pr)).values()) expect(stage.offSteps).toEqual([]);
  });
});
