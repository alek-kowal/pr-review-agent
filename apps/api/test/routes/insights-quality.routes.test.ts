// S-19-T4: Insights Quality. Own database: rates read every round and finding.
import {
  closeDb,
  createDb,
  ensureInstructionFile,
  schema,
  upsertRepository,
  type Db,
} from '@pra/db';
import {
  aRepositoryConfig,
  createTestDatabase,
  seedPrHistory,
  type SeededFinding,
  type TestDatabase,
} from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { QualityResponse } from '../../src/routes/api/insights/index.ts';
import { build } from '../helper.ts';

const DAY = 86_400_000;

let database: TestDatabase;
let db: Db;
let slug: string;
let versions: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
  versions = await seed();
}, 30_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.drop();
});

const many = (n: number, finding: SeededFinding): SeededFinding[] =>
  Array.from({ length: n }, () => ({ ...finding }));

/**
 * Hand-computed fixture, all in the last 30 days unless noted:
 * - level 1: 2 rounds ($0.40, $0.60), 6 unchecked findings, decided 2 Implement + 1 Reject;
 * - level 3: 2 rounds ($1, $2), 8 findings (4 Confirmed, 2 Refuted, 1 Not proven, 1 Unchecked),
 *   decided 3 Implement + 1 Reject + 1 Defer;
 * - level 4: 1 round with 4 findings, no instruction version recorded;
 * - a level 3 trial and a level 3 round 40 days ago, both with findings, count nowhere.
 * Level 1 rounds read review-rules.md v1 (archived); level 3 rounds read v2 (active) and
 * verify-rules.md v1.
 */
async function seed() {
  const repository = await upsertRepository(db, aRepositoryConfig());
  slug = repository.slug;
  const version = async (fileKey: string, n: number, status: 'active' | 'archived') => {
    const file = await ensureInstructionFile(db, {
      scope: 'global',
      fileKey: `${fileKey}-${slug}`,
      kind: 'instruction',
    });
    const [row] = await db
      .insert(schema.instructionVersions)
      .values({ fileId: file.id, version: n, status, content: '' })
      .returning();
    return { id: row!.id, scope: 'global' as const, fileKey: file.fileKey, version: n };
  };
  const reviewV1 = await version('review-rules.md', 1, 'archived');
  const reviewV2 = await version('review-rules.md', 2, 'active');
  const verifyV1 = await version('verify-rules.md', 1, 'active');
  const recent = Date.now() - 3 * DAY;
  const at = (hours: number) => new Date(recent + hours * 3_600_000);

  await seedPrHistory(db, {
    repositoryId: repository.id,
    readyAt: at(0),
    runs: [
      {
        startedAt: at(1),
        costUsd: 0.4,
        instructionVersions: [reviewV1],
        findings: [
          { decision: 'implement' },
          { decision: 'implement' },
          { decision: 'reject' },
          ...many(1, {}),
        ],
      },
      { startedAt: at(2), costUsd: 0.6, instructionVersions: [reviewV1], findings: many(2, {}) },
    ],
  });
  await seedPrHistory(db, {
    repositoryId: repository.id,
    readyAt: at(5),
    runs: [
      {
        levelNumber: 3,
        startedAt: at(6),
        costUsd: 1,
        instructionVersions: [reviewV2, verifyV1],
        findings: [
          { verdict: 'confirmed', decision: 'implement' },
          { verdict: 'confirmed', decision: 'implement' },
          { verdict: 'confirmed', decision: 'implement' },
          { verdict: 'refuted', decision: 'reject' },
        ],
      },
      {
        levelNumber: 3,
        startedAt: at(7),
        costUsd: 2,
        instructionVersions: [reviewV2, verifyV1],
        findings: [
          { verdict: 'confirmed', decision: 'defer' },
          { verdict: 'refuted' },
          { verdict: 'not_proven' },
          { verdict: 'unchecked', severity: 'nit' },
        ],
      },
      {
        kind: 'trial',
        levelNumber: 3,
        startedAt: at(8),
        instructionVersions: [reviewV2],
        findings: many(5, { verdict: 'refuted', decision: 'reject' }),
      },
    ],
  });
  await seedPrHistory(db, {
    repositoryId: repository.id,
    readyAt: at(10),
    runs: [{ levelNumber: 4, startedAt: at(11), costUsd: 1.5, findings: many(4, {}) }],
  });
  await seedPrHistory(db, {
    repositoryId: repository.id,
    readyAt: new Date(Date.now() - 40 * DAY),
    runs: [
      {
        levelNumber: 3,
        startedAt: new Date(Date.now() - 40 * DAY),
        instructionVersions: [reviewV2],
        findings: many(5, { verdict: 'refuted', decision: 'reject' }),
      },
    ],
  });
  return { reviewV1, reviewV2, verifyV1 };
}

async function quality(query = '') {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: `/api/insights/quality?${query}` });
  expect(response.statusCode).toBe(200);
  return QualityResponse.parse(response.json());
}

test('per level: rates match the hand-computed fixture', async () => {
  const { reviewV1, reviewV2, verifyV1 } = versions;
  const body = await quality(`range=30&repo=${slug}`);
  const level = (n: number) => body.levels.find((row) => row.level === n)!;

  expect(body.levels.map((row) => row.level)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(level(1)).toEqual({
    level: 1,
    rounds: 2,
    findings: 6,
    decided: 3,
    unchecked: true,
    tooFew: false,
    confirmedRate: null,
    refutedRate: null,
    implementShare: 2 / 3,
    averageRoundUsd: 0.5,
  });
  expect(level(3)).toEqual({
    level: 3,
    rounds: 2,
    findings: 8,
    decided: 5,
    unchecked: false,
    tooFew: false,
    confirmedRate: 4 / 8,
    refutedRate: 2 / 8,
    implementShare: 3 / 5,
    averageRoundUsd: 1.5,
  });
  // A level with 4 findings hides its rates.
  expect(level(4)).toMatchObject({
    rounds: 1,
    findings: 4,
    tooFew: true,
    unchecked: false,
    confirmedRate: null,
    refutedRate: null,
    implementShare: null,
  });
  expect(level(2)).toMatchObject({ rounds: 0, findings: 0, tooFew: true, averageRoundUsd: null });

  // Per instruction version: by file, newest first; runs with none recorded last.
  expect(body.versions.map((row) => [row.instruction?.id ?? null, row.runs, row.findings])).toEqual(
    [
      [reviewV2.id, 2, 8],
      [reviewV1.id, 2, 6],
      [verifyV1.id, 2, 8],
      [null, 1, 4],
    ],
  );
  const [v2, v1, , none] = body.versions;
  expect(v2).toMatchObject({
    // The file's stored kind (KINDS).
    instruction: {
      fileKey: reviewV2.fileKey,
      kind: 'instruction',
      version: 2,
      active: true,
      scope: 'global',
    },
    confirmedRate: 0.5,
    implementShare: 0.6,
    averageCostUsd: 1.5,
  });
  expect(v1).toMatchObject({
    instruction: { active: false },
    unchecked: true,
    confirmedRate: null,
    implementShare: 2 / 3,
  });
  expect(none).toMatchObject({ instruction: null, tooFew: true, implementShare: null });
});

test('the range and the repository filter apply', async () => {
  const recent = await quality(`range=14&repo=${slug}`);
  expect(recent.levels.find((row) => row.level === 3)!.rounds).toBe(2);
  const other = await upsertRepository(db, aRepositoryConfig());
  const empty = await quality(`repo=${other.slug}`);
  expect(empty.levels.every((row) => row.rounds === 0 && row.tooFew)).toBe(true);
  expect(empty.versions).toEqual([]);
});
