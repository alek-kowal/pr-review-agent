// S-07-T4: Start review by hand, the PR's level, and the head-aware PR summary.
import {
  closeDb,
  createDb,
  createQueue,
  eq,
  getRun,
  schema,
  upsertPullRequest,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRepositoryConfig, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { FindingsResponse } from '../../src/routes/api/prs/index.ts';
import { PrLevelResponse, StartReviewResponse } from '../../src/routes/api/rounds/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
// Sends need a started pg-boss instance; no worker takes the jobs.
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});

let app: FastifyInstance;
let repository: Repository;

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

const sha = (c: string) => c.repeat(40);
const url = (pr: PullRequest, path = '') => `/api/prs/${repository.slug}/${pr.number}${path}`;

const startReview = (pr: PullRequest, level: number) =>
  app.inject({
    method: 'POST',
    url: url(pr, '/start-review'),
    headers: SAME_ORIGIN,
    payload: { level },
  });

const setLevel = (pr: PullRequest, level: number | null) =>
  app.inject({ method: 'PUT', url: url(pr, '/level'), headers: SAME_ORIGIN, payload: { level } });

async function view(pr: PullRequest) {
  const response = await app.inject({ method: 'GET', url: url(pr) });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function runsOf(pr: PullRequest) {
  return db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.pullRequestId, pr.id))
    .orderBy(schema.runs.id);
}

describe('start review', () => {
  test('a start on a draft creates a new chain round 1 by hand at the picked level', async () => {
    const pr = await seedPr(db, repository.id, { isDraft: true });
    const response = await startReview(pr, 3);

    expect(response.statusCode).toBe(201);
    const body = StartReviewResponse.parse(response.json());
    expect(body).toMatchObject({ roundNumber: 1, level: 3 });
    expect(await getRun(db, body.runId)).toMatchObject({
      status: 'queued',
      trigger: 'manual',
      startedBy: 'hand',
      roundNo: 1,
      chainId: body.chainId,
    });
  });

  test('a start on a ready-to-merge PR begins a new chain', async () => {
    const pr = await seedPr(db, repository.id);
    const { run: reviewed } = await seedRound(db, pr);
    expect((await view(pr)).nextStep.state).toBe('ready_to_merge');

    const body = StartReviewResponse.parse((await startReview(pr, 2)).json());

    expect(body.roundNumber).toBe(1);
    expect(body.chainId).not.toBe(reviewed.chainId);
  });

  test('a second start while one is queued or running returns 409 run_active', async () => {
    const pr = await seedPr(db, repository.id);
    expect((await startReview(pr, 1)).statusCode).toBe(201);

    const second = await startReview(pr, 1);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: 'run_active', params: { kind: 'round', status: 'queued' } },
    });
    expect(await runsOf(pr)).toHaveLength(1);
  });

  test('a start without the CSRF headers is refused', async () => {
    const pr = await seedPr(db, repository.id);
    const response = await app.inject({
      method: 'POST',
      url: url(pr, '/start-review'),
      payload: { level: 1 },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('PR level', () => {
  test('a level change applies to the next round and leaves the running one', async () => {
    const pr = await seedPr(db, repository.id);
    const { runId } = StartReviewResponse.parse((await startReview(pr, 3)).json());
    await db.update(schema.runs).set({ status: 'running' }).where(eq(schema.runs.id, runId));

    const response = await setLevel(pr, 5);

    expect(response.statusCode).toBe(200);
    const { head } = PrLevelResponse.parse(response.json());
    expect(head.level).toEqual({ pr: 5, repositoryDefault: 1, next: 5 });
    expect((await getRun(db, runId))!.level.number).toBe(3);
    const entries = await db
      .select()
      .from(schema.timelineEntries)
      .where(eq(schema.timelineEntries.pullRequestId, pr.id));
    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: 'pr_level_changed',
        actor: 'hand',
        params: { from: null, to: 5 },
      }),
    );

    expect(PrLevelResponse.parse((await setLevel(pr, null)).json()).head.level.next).toBe(1);
  });
});

describe('head-aware summary', () => {
  test('after a 2-commit push: new commits, 2 since, findings 2 commits behind', async () => {
    const pr = await seedPr(db, repository.id, { headSha: sha('a'), commitsCount: 1 });
    await seedRound(db, pr, { findings: [{ title: 'Empty label' }] });
    await upsertPullRequest(
      db,
      aPullRequest(repository.id, {
        number: pr.number,
        headSha: sha('c'),
        commitsCount: 3,
        updatedAt: new Date(),
      }),
    );

    const page = await view(pr);
    expect(page.nextStep.state).toBe('new_commits');
    expect(page.head).toMatchObject({
      reviewedSha: sha('a'),
      headSha: sha('c'),
      commitsSince: 2,
      completedRounds: 1,
      maxRounds: 3,
      fixes: null,
    });

    const findings = FindingsResponse.parse(
      (await app.inject({ method: 'GET', url: url(pr, '/findings') })).json(),
    );
    expect(findings.findings).toEqual([
      expect.objectContaining({
        title: 'Empty label',
        sourceSha: sha('a'),
        commitsBehind: 2,
        fix: null,
      }),
    ]);
  });
});
