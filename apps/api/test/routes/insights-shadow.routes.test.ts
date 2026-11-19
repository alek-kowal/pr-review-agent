// S-19-T9: Insights → Trust ladder adds each repository's level 5 shadow log: the latest entry per
// PR at level 3+ in the last 14 days, how many would have been fixed, and "not enough data" below
// 5 PRs. Own database: the endpoint lists every repository.
import { reason, type Reason } from '@pra/core';
import { closeDb, createDb, recordShadow, type Db } from '@pra/db';
import { createTestDatabase, seedPullRequest, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { TrustResponse } from '../../src/routes/api/insights/index.ts';
import { build } from '../helper.ts';

const DAY = 86_400_000;

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

async function trust(query = '') {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: `/api/insights/trust?${query}` });
  expect(response.statusCode).toBe(200);
  return TrustResponse.parse(response.json());
}

type Decision = 'would_start' | 'would_push' | 'would_wait';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
const met = reason('autofix_conditions_met', { count: 1 });
const questions = reason('open_questions', { count: 2 });
const sensitive = reason('patch_touches_sensitive', {
  path: 'infra/deploy.yml',
  pattern: 'infra/**',
});

/** One shadow entry of PR `number` in repository `slug` (seeded at `level`). */
async function shadow(
  slug: string,
  level: 3 | 4,
  number: number,
  decision: Decision,
  at: Date,
  why: Reason = decision === 'would_wait' ? questions : met,
  entryLevel: number = level,
) {
  const { repository, pullRequest } = await seedPullRequest(db, {
    repository: { slug, githubFullName: `acme/${slug}`, defaultLevel: level },
    pullRequest: { number },
  });
  await recordShadow(db, {
    pullRequestId: pullRequest.id,
    repositoryId: repository.id,
    level: entryLevel,
    point: decision === 'would_start' ? 'start' : 'push',
    decision,
    reasons: [why],
    fixed: decision === 'would_wait' ? 1 : 2,
    total: 2,
    at,
  });
}

test('counts the latest entry per PR at level 3+ in the last 14 days; the repo filter applies', async () => {
  // Five PRs at level 3: three would have been fixed, two would have waited.
  await shadow('a-shadow', 3, 1, 'would_wait', hoursAgo(50));
  await shadow('a-shadow', 3, 1, 'would_push', hoursAgo(10)); // latest of #1
  await shadow('a-shadow', 3, 2, 'would_start', hoursAgo(20));
  await shadow('a-shadow', 3, 3, 'would_wait', hoursAgo(30));
  await shadow('a-shadow', 3, 4, 'would_wait', hoursAgo(40), sensitive);
  await shadow('a-shadow', 3, 5, 'would_push', hoursAgo(5));
  // Not counted: older than 14 days, and an entry written at level 2.
  await shadow('a-shadow', 3, 6, 'would_push', new Date(Date.now() - 15 * DAY));
  await shadow('a-shadow', 3, 7, 'would_push', hoursAgo(1), met, 2);
  // Two PRs at level 4: not enough data yet.
  await shadow('b-shadow', 4, 1, 'would_push', hoursAgo(3));
  await shadow('b-shadow', 4, 2, 'would_wait', hoursAgo(4));

  const all = await trust();
  const a = all.repositories.find((row) => row.repository === 'a-shadow')!;
  expect(a.shadow).toMatchObject({ days: 14, eligible: 5, needed: 5, wouldFix: 3 });
  // Newest first, one row per PR.
  expect(a.shadow.prs).toEqual([
    { number: 5, decision: 'would_push', reason: met, fixed: 2, total: 2, at: expect.any(String) },
    { number: 1, decision: 'would_push', reason: met, fixed: 2, total: 2, at: expect.any(String) },
    { number: 2, decision: 'would_start', reason: met, fixed: 2, total: 2, at: expect.any(String) },
    {
      number: 3,
      decision: 'would_wait',
      reason: questions,
      fixed: 1,
      total: 2,
      at: expect.any(String),
    },
    {
      number: 4,
      decision: 'would_wait',
      reason: sensitive,
      fixed: 1,
      total: 2,
      at: expect.any(String),
    },
  ]);

  const b = all.repositories.find((row) => row.repository === 'b-shadow')!;
  expect(b.shadow).toMatchObject({ eligible: 2, needed: 5, wouldFix: 1 });
  expect(b.shadow.prs.map((pr) => pr.number)).toEqual([1, 2]);

  const filtered = await trust('repo=b-shadow');
  expect(filtered.repositories.map((row) => row.repository)).toEqual(['b-shadow']);
  expect(filtered.repositories[0]!.shadow).toMatchObject({ eligible: 2, wouldFix: 1 });
});

test('a repository with no shadow entry has an empty log', async () => {
  await seedPullRequest(db, {
    repository: { slug: 'c-quiet', githubFullName: 'acme/c-quiet', defaultLevel: 1 },
  });
  const { repositories } = await trust('repo=c-quiet');
  expect(repositories[0]!.shadow).toEqual({
    days: 14,
    eligible: 0,
    needed: 5,
    wouldFix: 0,
    prs: [],
  });
});
