// S-19-T4: Insights Trust ladder. Own database: it lists every repository.
import { closeDb, createDb, insertSettingsChange, upsertRepository, type Db } from '@pra/db';
import {
  aRepositoryConfig,
  createTestDatabase,
  seedPrHistory,
  type SeededFinding,
  type TestDatabase,
} from '@pra/db/testing';
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

const many = (n: number, finding: SeededFinding): SeededFinding[] =>
  Array.from({ length: n }, () => ({ ...finding }));

async function trust(query = '') {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: `/api/insights/trust?${query}` });
  expect(response.statusCode).toBe(200);
  return TrustResponse.parse(response.json());
}

test('one row per repository with its level, days at it and that level rates', async () => {
  const verified = await upsertRepository(
    db,
    aRepositoryConfig({ slug: 'a-verified', defaultLevel: 3 }),
  );
  const fresh = await upsertRepository(db, aRepositoryConfig({ slug: 'b-fresh', defaultLevel: 1 }));
  // The level went 1 → 3 seven days ago; a later edit of another field keeps that date.
  const levelSetAt = new Date(Date.now() - 7 * DAY - 3_600_000);
  await insertSettingsChange(db, {
    area: 'repositories',
    entity: String(verified.id),
    actor: 'hand',
    at: levelSetAt,
    before: { ...verified.config, defaultLevel: 1 },
    after: verified.config,
  });
  await insertSettingsChange(db, {
    area: 'repositories',
    entity: String(verified.id),
    actor: 'hand',
    at: new Date(Date.now() - DAY),
    before: verified.config,
    after: { ...verified.config, largePrLines: 500 },
  });
  const start = Date.now() - 20 * DAY;
  const at = (days: number) => new Date(start + days * DAY);
  await seedPrHistory(db, {
    repositoryId: verified.id,
    readyAt: at(0),
    runs: [
      // Level 1 rounds from before the change do not count for level 3.
      { startedAt: at(0), findings: many(6, { decision: 'reject' }) },
      {
        levelNumber: 3,
        startedAt: at(14),
        findings: [
          ...many(3, { verdict: 'confirmed', decision: 'implement' }),
          { verdict: 'refuted', decision: 'reject' },
        ],
      },
      { levelNumber: 3, startedAt: at(15), findings: many(1, { verdict: 'not_proven' }) },
    ],
  });
  await seedPrHistory(db, {
    repositoryId: fresh.id,
    readyAt: at(1),
    runs: [{ startedAt: at(1), findings: many(3, { decision: 'implement' }) }],
  });

  const body = await trust();
  expect(body.repositories.map((row) => row.repository)).toEqual(['a-verified', 'b-fresh']);
  expect(body.repositories[0]).toEqual({
    repositoryId: verified.id,
    repository: 'a-verified',
    level: 3,
    since: levelSetAt.toISOString(),
    days: 7,
    rounds: 2,
    findings: 5,
    decided: 4,
    unchecked: false,
    tooFew: false,
    confirmedRate: 3 / 5,
    refutedRate: 1 / 5,
    implementShare: 3 / 4,
    shadow: { days: 14, eligible: 0, needed: 5, wouldFix: 0, prs: [] },
  });
  // No level change logged: since it was connected. 3 findings are too few.
  expect(body.repositories[1]).toMatchObject({
    repository: 'b-fresh',
    level: 1,
    days: 0,
    rounds: 1,
    findings: 3,
    tooFew: true,
    unchecked: true,
    implementShare: null,
  });

  const filtered = await trust('repo=b-fresh');
  expect(filtered.repositories.map((row) => row.repository)).toEqual(['b-fresh']);
});

test('an unknown repository is a 404', async () => {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: '/api/insights/trust?repo=nope' });
  expect(response.statusCode).toBe(404);
});
