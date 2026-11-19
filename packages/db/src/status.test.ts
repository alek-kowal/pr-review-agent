import { DEFAULT_APP_SETTINGS } from '@pra/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  getAppSettings,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  schema,
  spentToday,
  startOfLocalDay,
  type Db,
} from './index.ts';
import { aRun, createTestDatabase, seedPullRequest, type TestDatabase } from './testing/index.ts';

// app_settings is one row for the whole app, so this file uses its own database.
let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
});
afterAll(async () => {
  await closeDb(db);
  await database.drop();
});

async function sessionAt(createdAt: string, costUsd: number) {
  const { pullRequest } = await seedPullRequest(db);
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));
  const stage = await insertStageExecution(db, {
    runId: run.id,
    stage: 'review',
    status: 'succeeded',
  });
  await insertAgentSession(db, {
    stageExecutionId: stage.id,
    role: 'reviewer',
    model: 'claude-opus-5-5',
    costUsd,
    costSource: 'reported',
    status: 'succeeded',
    createdAt: new Date(createdAt),
  });
}

describe('status data', () => {
  test('the migration creates the one status row with 2 agent slots and Warsaw time', async () => {
    const rows = await db.select().from(schema.appSettings);
    expect(rows).toHaveLength(1);
    const settings = (await getAppSettings(db)).value;
    expect(settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(settings).toMatchObject({
      paused: false,
      pausedBy: null,
      pausedReason: null,
      pausedAt: null,
      dailyBudgetUsd: null,
      agentSlots: 2,
      timeZone: 'Europe/Warsaw',
    });
  });

  test('local midnight follows the zone, not UTC', async () => {
    // 2026-11-19 00:30 in Warsaw (UTC+1) is 2026-11-18 23:30 UTC.
    const now = new Date('2026-11-18T23:30:00Z');
    expect((await startOfLocalDay(db, 'Europe/Warsaw', now)).toISOString()).toBe(
      '2026-11-18T23:00:00.000Z',
    );
    expect((await startOfLocalDay(db, 'UTC', now)).toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });

  test('spentToday counts only sessions after local midnight in the configured zone', async () => {
    // Warsaw midnight of 2026-11-20 is 2026-11-19 23:00 UTC.
    await sessionAt('2026-11-19T22:30:00Z', 7); // 23:30 in Warsaw: yesterday
    await sessionAt('2026-11-19T23:30:00Z', 1.25); // 00:30 in Warsaw: today
    await sessionAt('2026-11-20T08:00:00Z', 2.5); // 09:00 in Warsaw: today

    const now = new Date('2026-11-20T09:00:00Z');
    const warsaw = await spentToday(db, { timeZone: 'Europe/Warsaw', now });
    expect(warsaw).toEqual({ spentUsd: 3.75, since: new Date('2026-11-19T23:00:00Z') });

    // The same sessions counted from UTC midnight leave out 00:30 Warsaw (23:30 UTC).
    const utc = await spentToday(db, { timeZone: 'UTC', now });
    expect(utc.spentUsd).toBe(2.5);
  });
});
