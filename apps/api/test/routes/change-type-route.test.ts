// S-04-T6: a person forces the PR's change type (FR-030): stored on the PR, recorded "by hand" on
// the timeline, and the PR view's `checks` section shows the latest completed round's Checks and
// Change type outputs with the large-PR warning.
import {
  closeDb,
  createDb,
  eq,
  insertRun,
  insertStageExecution,
  schema,
  timelineOf,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, aRun, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { ChangeTypeResponse } from '../../src/routes/api/change-type/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });

let app: FastifyInstance;
let repository: Repository;

beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig({ slug: 'change-type-route' }));
});
afterAll(() => closeDb(db));
beforeEach(async () => {
  app = await build({ db });
});

const force = (
  number: number,
  changeType: string | null,
  headers: Record<string, string> = SAME_ORIGIN,
) =>
  app.inject({
    method: 'PUT',
    url: `/api/prs/change-type-route/${number}/change-type`,
    headers,
    payload: { changeType },
  });

async function prView(number: number) {
  const response = await app.inject({ method: 'GET', url: `/api/prs/change-type-route/${number}` });
  expect(response.statusCode).toBe(200);
  return response.json() as { checks: unknown };
}

/** A completed level-2 round whose Change type is over the large-PR threshold. */
async function seedCompletedRound(pullRequest: PullRequest) {
  const run = await insertRun(
    db,
    aRun(pullRequest.id, { levelNumber: 2, headSha: pullRequest.headSha, status: 'completed' }),
  );
  const finished = { attempt: 1, startedAt: new Date(), finishedAt: new Date() };
  await insertStageExecution(db, {
    runId: run.id,
    stage: 'checks',
    status: 'succeeded',
    output: {
      ci: { passed: 4, failed: 1, pending: 0, checks: [] },
      install: { status: 'passed', failedStep: null, fetch: null, install: null, logBlobKey: null },
    },
    ...finished,
  });
  await insertStageExecution(db, {
    runId: run.id,
    stage: 'change_type',
    status: 'succeeded',
    output: {
      changeType: 'changes_behaviour',
      reason: { code: 'judge_raised', params: {} },
      rules: { changeType: 'uses_existing', reason: { code: 'paths_uses_existing', params: {} } },
      judge: { changeType: 'changes_behaviour', reason: 'It changes the edge label.' },
      judgeSkipped: null,
      forced: null,
      needsPerson: false,
      lines: 1240,
      largePr: true,
      largePrLines: 800,
    },
    ...finished,
  });
  return run;
}

describe('force the change type', () => {
  test('a forced type is stored and recorded by hand on the timeline', async () => {
    const pullRequest = await seedPr(db, repository.id);

    const response = await force(pullRequest.number, 'one_way_door');

    expect(response.statusCode).toBe(200);
    expect(ChangeTypeResponse.parse(response.json()).checks.forced).toBe('one_way_door');
    const [stored] = await db
      .select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.id, pullRequest.id));
    expect(stored?.forcedChangeType).toBe('one_way_door');
    expect(await timelineOf(db, pullRequest.id)).toEqual([
      expect.objectContaining({
        kind: 'change_type_forced',
        actor: 'hand',
        params: { from: null, to: 'one_way_door' },
      }),
    ]);

    // Clearing it is recorded too; the same value again writes nothing.
    expect((await force(pullRequest.number, null)).statusCode).toBe(200);
    expect((await force(pullRequest.number, null)).statusCode).toBe(200);
    const entries = (await timelineOf(db, pullRequest.id)).map((e) => e.params);
    expect(entries).toEqual([
      { from: null, to: 'one_way_door' },
      { from: 'one_way_door', to: null },
    ]);
  });

  test('an unknown type is refused; an unknown PR is 404; a request without the header is 403', async () => {
    const pullRequest = await seedPr(db, repository.id);
    expect((await force(pullRequest.number, 'big')).statusCode).toBe(400);
    expect((await force(999_999, 'one_way_door')).statusCode).toBe(404);
    expect((await force(pullRequest.number, 'one_way_door', {})).statusCode).toBe(403);
  });
});

describe('the PR view checks section', () => {
  test('shows the latest completed round: change type and how, CI, install and large PR', async () => {
    const pullRequest = await seedPr(db, repository.id);
    const run = await seedCompletedRound(pullRequest);

    expect((await prView(pullRequest.number)).checks).toEqual({
      runId: run.id,
      changeType: { value: 'changes_behaviour', reason: { code: 'judge_raised', params: {} } },
      forced: null,
      largePr: { lines: 1240, threshold: 800 },
      ci: { passed: 4, failed: 1, pending: 0 },
      install: { status: 'passed' },
    });
  });

  test('is empty before the first completed round', async () => {
    const pullRequest = await seedPr(db, repository.id);
    expect((await prView(pullRequest.number)).checks).toEqual({
      runId: null,
      changeType: null,
      forced: null,
      largePr: null,
      ci: null,
      install: null,
    });
  });
});
