import { DEFAULT_ALERT_CONFIG, reason } from '@pra/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  activeAlertCountsByPr,
  activeAlertsForPr,
  closeDb,
  countActiveAlerts,
  countPastAlerts,
  createDb,
  dismissAlert,
  getAlertConfig,
  insertAlert,
  knownAlerts,
  listActiveAlerts,
  listPastAlerts,
  resolveAlerts,
  setAlertDelivery,
  sql,
  writeAlertConfig,
  type Db,
  type NewAlert,
} from './index.ts';
import { createTestDatabase, seedPullRequest, type TestDatabase } from './testing/index.ts';

// Alerts and their config are app-wide, so this file uses its own database.
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

const costAlert = (prId: number, number: number): NewAlert => ({
  kind: 'cost',
  key: `cost:${prId}`,
  pullRequestId: prId,
  title: reason('alert_cost', { prNumber: number, spentUsd: 6, maxUsd: 5 }),
  nextStep: reason('alert_next_split'),
  clickupTaskId: 'WB-1',
  toGeneralTask: false,
});

describe('alert config', () => {
  test('the defaults exist after migrate', async () => {
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from alert_config`);
    expect(rows.rows[0]?.n).toBe(1);
    expect(await getAlertConfig(db)).toEqual(DEFAULT_ALERT_CONFIG);
  });

  test('writes and reads back the config', async () => {
    const next = { ...DEFAULT_ALERT_CONFIG, costMaxUsd: 7.5, budgetPercent: 90 as const };
    await writeAlertConfig(db, { ...next, generalTaskId: 'WB-700' });
    expect(await getAlertConfig(db)).toEqual({ ...next, generalTaskId: 'WB-700' });
    await writeAlertConfig(db, DEFAULT_ALERT_CONFIG);
  });

  test('refuses a cost of 0', async () => {
    await expect(
      writeAlertConfig(db, { ...DEFAULT_ALERT_CONFIG, costMaxUsd: 0 }),
    ).rejects.toThrow();
  });
});

describe('alerts', () => {
  test('insert is idempotent per key', async () => {
    const { pullRequest } = await seedPullRequest(db);
    const first = await insertAlert(db, costAlert(pullRequest.id, pullRequest.number));
    expect(first).toMatchObject({ status: 'active', deliveryStatus: 'pending', kind: 'cost' });
    expect(await insertAlert(db, costAlert(pullRequest.id, pullRequest.number))).toBeNull();
    const known = await knownAlerts(db, [`cost:${pullRequest.id}`]);
    expect(known.filter((a) => a.key === `cost:${pullRequest.id}`)).toEqual([
      {
        key: `cost:${pullRequest.id}`,
        kind: 'cost',
        prId: String(pullRequest.id),
        status: 'active',
      },
    ]);
  });

  test('the active, past and per-PR queries', async () => {
    const { pullRequest, repository } = await seedPullRequest(db);
    const pastBefore = await countPastAlerts(db);
    const activeBefore = await countActiveAlerts(db);
    const failed = await insertAlert(db, {
      kind: 'failed',
      key: `failed:${pullRequest.id}:1`,
      pullRequestId: pullRequest.id,
      title: reason('alert_failed', {
        prNumber: pullRequest.number,
        stage: 'review',
        errorCode: 'stage_timeout',
        timeoutMinutes: 30,
      }),
      nextStep: reason('alert_next_retry', { stage: 'review' }),
      clickupTaskId: null,
      toGeneralTask: true,
    });
    const cost = await insertAlert(db, costAlert(pullRequest.id, pullRequest.number));
    const budget = await insertAlert(db, {
      kind: 'budget',
      key: 'budget:2026-11-19:80',
      pullRequestId: null,
      title: reason('alert_budget', { percent: 80, spentUsd: 40, budgetUsd: 50 }),
      nextStep: reason('alert_next_budget'),
      clickupTaskId: null,
      toGeneralTask: true,
      deliveryStatus: 'not_configured',
    });

    expect(await countActiveAlerts(db)).toBe(activeBefore + 3);
    const forPr = await activeAlertsForPr(db, pullRequest.id);
    expect(forPr.map((a) => a.kind)).toEqual(['cost', 'failed']);
    expect(forPr[0]!.pr).toEqual({
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      repo: repository.slug,
    });
    expect((await activeAlertCountsByPr(db, [pullRequest.id])).get(pullRequest.id)).toBe(2);
    const active = await listActiveAlerts(db);
    expect(active.find((a) => a.id === budget!.id)).toMatchObject({
      pr: null,
      deliveryStatus: 'not_configured',
    });

    await setAlertDelivery(db, cost!.id, { status: 'sent', commentId: 'c-9' });
    const resolved = await resolveAlerts(db, [
      { key: failed!.key, note: reason('alert_end_retried') },
    ]);
    expect(resolved).toMatchObject([{ status: 'resolved', endedBy: 'bot' }]);
    expect(
      await resolveAlerts(db, [{ key: failed!.key, note: reason('alert_end_retried') }]),
    ).toEqual([]);
    const dismissed = await dismissAlert(db, cost!.id);
    expect(dismissed).toMatchObject({
      status: 'dismissed',
      endedBy: 'hand',
      commentId: 'c-9',
      deliveryStatus: 'sent',
    });
    expect(dismissed!.postedAt).toBeInstanceOf(Date);
    expect(await dismissAlert(db, cost!.id)).toBeNull();

    expect(await activeAlertsForPr(db, pullRequest.id)).toEqual([]);
    expect(await countPastAlerts(db)).toBe(pastBefore + 2);
    const past = await listPastAlerts(db);
    expect(past.slice(0, 2).map((a) => a.id)).toEqual([cost!.id, failed!.id]);
    expect(past[1]!.endNote).toEqual({ code: 'alert_end_retried', params: {} });
  });
});
