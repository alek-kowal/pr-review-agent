import { DEFAULT_MODELS } from '@pra/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  asc,
  closeDb,
  createDb,
  getLevelOverrides,
  getRoleModels,
  lockLevelSettings,
  lockRoleModels,
  schema,
  writeLevelSettings,
  writeRoleModels,
  type Db,
} from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/index.ts';

// Its own database: level and model settings are global.
let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 3 });
}, 30_000);

afterAll(async () => {
  await closeDb(db);
  await database.drop();
});

describe('level and model settings (S-21-T1)', () => {
  test('the migration applies with the defaults', async () => {
    const levels = await db
      .select()
      .from(schema.levelSettings)
      .orderBy(asc(schema.levelSettings.level));
    expect(levels.map((row) => [row.level, row.settings])).toEqual([
      [1, {}],
      [2, {}],
      [3, {}],
      [4, {}],
      [5, {}],
      [6, {}],
    ]);
    expect(await getRoleModels(db)).toEqual(DEFAULT_MODELS);
    expect((await getLevelOverrides(db)).value).toEqual({
      1: {},
      2: {},
      3: {},
      4: {},
      5: {},
      6: {},
    });
  });

  test('a level’s own values and the models round-trip; a broken stored field falls back', async () => {
    await db.transaction(async (tx) => {
      expect(await lockLevelSettings(tx, 3)).toEqual({});
      await writeLevelSettings(tx, 3, { stageTimeoutMinutes: 12, models: { verifier: 'v-1' } });
      expect(await lockRoleModels(tx)).toEqual(DEFAULT_MODELS);
      await writeRoleModels(tx, { verifier: 'claude-haiku-5-5' });
    });
    expect((await getLevelOverrides(db)).value[3]).toEqual({
      stageTimeoutMinutes: 12,
      models: { verifier: 'v-1' },
    });
    expect((await getRoleModels(db)).verifier).toBe('claude-haiku-5-5');

    await db
      .update(schema.levelSettings)
      .set({ settings: { maxFindings: 99, maxQuestions: 1 } as never });
    const parsed = await getLevelOverrides(db);
    expect(parsed.value[1]).toEqual({ maxQuestions: 1 });
    expect(parsed.warnings[0]?.params).toEqual({ field: '1.maxFindings', issue: 'too_big' });
  });
});
