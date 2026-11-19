// S-19-T3: Insights Overview and Cost. Own database: the metrics read every finished PR and
// every session, so other files' rows would change them.
import { closeDb, createDb, sql, upsertRepository, type Db } from '@pra/db';
import {
  aRepositoryConfig,
  createTestDatabase,
  seedPrHistory,
  type TestDatabase,
} from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { CostResponse, OverviewResponse } from '../../src/routes/api/insights/index.ts';
import { build } from '../helper.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let database: TestDatabase;
let db: Db;
let main: string;
let other: string;
const mainCosts: number[] = [];
const otherCosts: number[] = [];

/**
 * 17 merged PRs in `main` (5 by ola, 12 by kuba) and 3 by ola in `other`, all in the last 14
 * days; one more `other` PR 25 days ago. Each PR: ready → agents 30 min → action needed 90 min →
 * ready to merge 60 min → merged, with one round. The first `main` PR adds a trial and an analyst
 * run. A kuba PR has a base merge pushed by ola, so ola touches a PR she did not author.
 */
async function seed() {
  const a = await upsertRepository(db, aRepositoryConfig());
  const b = await upsertRepository(db, aRepositoryConfig());
  main = a.slug;
  other = b.slug;
  const base = Date.now() - 5 * 24 * HOUR;
  const pr = async (repositoryId: number, i: number, author: string, readyMs: number) => {
    const readyAt = new Date(readyMs);
    const at = (minutes: number) => new Date(readyMs + minutes * MINUTE);
    const costUsd = Math.round((0.1 + i * 0.05) * 100) / 100;
    await seedPrHistory(db, {
      repositoryId,
      authorLogin: author,
      readyAt,
      finishedAt: at(180),
      runs: [
        { startedAt: at(1), minutes: 10, costUsd, tokens: 100 },
        ...(repositoryId === a.id && i === 0
          ? [
              { kind: 'trial' as const, startedAt: at(20), costUsd: 2 },
              { kind: 'analyst' as const, startedAt: at(25), costUsd: 1.5 },
            ]
          : []),
      ],
      states: [
        { state: 'queued', at: readyAt },
        { state: 'findings_to_decide', at: at(30) },
        { state: 'ready_to_merge', at: at(120) },
        { state: 'merged', at: at(180) },
      ],
      headChanges:
        author === 'kuba' && i === 5
          ? [{ afterSha: 'c'.repeat(40), at: at(150), isBaseMerge: true, pusher: 'ola' }]
          : [],
    });
    return costUsd;
  };
  for (let i = 0; i < 17; i++) {
    mainCosts.push(await pr(a.id, i, i < 5 ? 'ola' : 'kuba', base + i * 4 * HOUR));
  }
  for (let i = 0; i < 3; i++) {
    otherCosts.push(await pr(b.id, i, 'ola', base + i * 4 * HOUR));
  }
  await pr(b.id, 9, 'ola', Date.now() - 25 * 24 * HOUR);
}

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
  await seed();
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.drop();
});

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

async function overview(query: string) {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: `/api/insights/overview?${query}` });
  expect(response.statusCode).toBe(200);
  return OverviewResponse.parse(response.json());
}

async function cost(query: string) {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: `/api/insights/cost?${query}` });
  expect(response.statusCode).toBe(200);
  return CostResponse.parse(response.json());
}

test('the repository filter gives every metric a sample of 17 and splits ready → merge', async () => {
  const body = await overview(`range=14&repo=${main}`);
  const { metrics } = body;
  for (const m of Object.values(metrics)) {
    expect(m).toMatchObject({ sampleSize: 17, tooFew: false });
  }
  expect(metrics.readyToMerge.valueMs).toBe(3 * HOUR);
  expect(metrics.readyToMerge.lanes).toEqual({
    agentsWorking: 17 * 30 * MINUTE,
    actionNeeded: 17 * 90 * MINUTE,
    readyToMerge: 17 * 60 * MINUTE,
  });
  expect(metrics.agentWork.valueMs).toBe(10 * MINUTE);
  expect(metrics.cost.valueUsd).toBeCloseTo(mainCosts[8]!);
  expect(metrics.cost.trialCostUsd).toBe(2);
  expect(metrics.cost.analystCostUsd).toBe(1.5);
  expect(metrics.changedAfterReady).toMatchObject({ count: 0, ignoredBaseMerges: 1 });
  expect(body.prs).toHaveLength(17);
  expect(new Set(body.prs.map((row) => row.repository))).toEqual(new Set([main]));
  expect(body.authors).toEqual(['kuba', 'ola']);
});

test('the range keeps PRs finished in the last 14 or 30 days', async () => {
  expect((await overview('range=14')).metrics.agentWork.sampleSize).toBe(20);
  expect((await overview('range=30')).metrics.agentWork.sampleSize).toBe(21);
  expect((await overview(`repo=${other}`)).metrics.agentWork.sampleSize).toBe(4);
});

test('the author filter uses the PR author and marks 5 PRs as too few', async () => {
  const body = await overview(`range=14&repo=${main}&author=ola`);
  expect(body.metrics.readyToMerge).toMatchObject({ sampleSize: 5, tooFew: true });
  expect(body.prs.map((row) => row.author)).toEqual(Array(5).fill('ola'));
  // Ola pushed to a kuba PR; that PR is not hers.
  expect(body.metrics.changedAfterReady.ignoredBaseMerges).toBe(0);
  // Every author in the range stays listed, so the filter can be changed.
  expect(body.authors).toEqual(['kuba', 'ola']);
});

test('cost totals equal the sessions; trials and the analyst come only as separate totals', async () => {
  const all = await cost('range=14');
  const prWork = sum(mainCosts) + sum(otherCosts);
  expect(all.totalUsd).toBeCloseTo(prWork);
  expect(sum(all.byDay.map((d) => d.costUsd))).toBeCloseTo(prWork);
  expect(all.byDay).toHaveLength(14);
  expect(sum(all.byRole.map((r) => r.costUsd))).toBeCloseTo(prWork);
  expect(all.byRole.map((r) => r.role)).toEqual(['reviewer']);
  expect(all.byLevel).toEqual([{ level: 1, costUsd: expect.closeTo(prWork, 5) }]);
  expect(all.separate).toEqual({ trial: 2, analyst: 1.5 });
  expect(all.byRepository).toEqual([
    { repository: main, costUsd: expect.closeTo(sum(mainCosts), 5) },
    { repository: other, costUsd: expect.closeTo(sum(otherCosts), 5) },
  ]);
  expect(all.averageRoundUsd).toBeCloseTo(prWork / 20);

  const onlyOther = await cost(`range=14&repo=${other}`);
  expect(onlyOther.totalUsd).toBeCloseTo(sum(otherCosts));
  expect(onlyOther.separate).toEqual({ trial: 0, analyst: 0 });
});

test('an unknown repository is a 404', async () => {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: '/api/insights/overview?repo=nope' });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({
    error: { code: 'repository_not_found', params: { repo: 'nope' } },
  });
});

test('a GET changes no row counts', async () => {
  const counts = async () =>
    (
      await db.execute<{ n: number }>(sql`
        select (select count(*) from pull_requests) + (select count(*) from runs)
          + (select count(*) from agent_sessions) + (select count(*) from pr_state_changes)
          + (select count(*) from head_changes) as n`)
    ).rows[0]!.n;
  const before = await counts();
  await overview(`range=30&repo=${main}&author=kuba`);
  await cost('range=30');
  expect(await counts()).toBe(before);
});
