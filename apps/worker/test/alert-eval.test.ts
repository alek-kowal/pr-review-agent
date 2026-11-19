// S-18-T3: alerts are re-evaluated after run changes, after session costs and every minute; fires
// and clears are stored, and each fire adds one PR timeline entry.
import { DEFAULT_ALERT_CONFIG, DEFAULT_APP_SETTINGS, HAND } from '@pra/core';
import {
  addRunCost,
  eq,
  getRun,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  retryRun,
  schema,
  sql,
  timelineOf,
  writeAlertConfig,
  writeAppSettings,
  type Db,
} from '@pra/db';
import { aRun, createTestDatabase, seedPullRequest, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { evaluateAlerts, localDay } from '../src/alerts/evaluate.ts';
import { listenForAlertTriggers } from '../src/alerts/triggers.ts';
import { createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

// Alerts, their config and the app settings are app-wide: this file uses its own database.
let database: TestDatabase;
let deps: TestWorkerDeps;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url, appBaseUrl: 'https://pra.example' });
  db = deps.db;
  await writeAlertConfig(db, { ...DEFAULT_ALERT_CONFIG, generalTaskId: 'WB-700' });
});
afterAll(async () => {
  await deps.close();
  await database.drop();
});

const alertsWithKey = (key: string) =>
  db.select().from(schema.alerts).where(eq(schema.alerts.key, key));

async function failedRound() {
  const { pullRequest } = await seedPullRequest(db);
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'failed' }));
  await insertStageExecution(db, {
    runId: run.id,
    stage: 'review',
    status: 'failed',
    errorCode: 'stage_timeout',
  });
  return { pullRequest, run };
}

describe('run failed', () => {
  test('a timed-out stage creates one run-failed alert, and a retry resolves it', async () => {
    const { pullRequest, run } = await failedRound();
    const key = `failed:${pullRequest.id}:${run.id}`;

    const first = await evaluateAlerts(deps);
    expect(first.fired.filter((a) => a.key === key)).toEqual([
      expect.objectContaining({
        kind: 'failed',
        status: 'active',
        title: expect.objectContaining({
          code: 'alert_failed',
          params: expect.objectContaining({ stage: 'review', errorCode: 'stage_timeout' }),
        }),
        nextStep: { code: 'alert_next_retry', params: { stage: 'review' } },
        // No linked task: the general alerts task.
        clickupTaskId: 'WB-700',
        toGeneralTask: true,
      }),
    ]);
    await evaluateAlerts(deps);
    expect(await alertsWithKey(key)).toHaveLength(1);
    const entries = (await timelineOf(db, pullRequest.id)).filter((e) => e.kind === 'alert_raised');
    expect(entries).toEqual([
      expect.objectContaining({
        actor: 'bot',
        params: expect.objectContaining({ alertKind: 'failed' }),
      }),
    ]);

    const retried = await retryRun({ db, queue: deps.queue }, run.id, HAND);
    expect(retried.retried).toBe(true);
    const after = await evaluateAlerts(deps);
    expect(after.resolved.map((a) => a.key)).toContain(key);
    expect((await alertsWithKey(key))[0]).toMatchObject({
      status: 'resolved',
      endedBy: 'bot',
      endNote: { code: 'alert_end_retried', params: {} },
    });
    // Clearing adds no timeline entry.
    expect(
      (await timelineOf(db, pullRequest.id)).filter((e) => e.kind === 'alert_raised'),
    ).toHaveLength(1);
  });
});

describe('cost of one PR', () => {
  test('spend crossing $5 creates one cost alert while the round still runs to completion', async () => {
    const { pullRequest } = await seedPullRequest(db);
    const run = await insertRun(db, aRun(pullRequest.id, { status: 'running' }));
    // A trial on the same PR does not count.
    const trial = await insertRun(
      db,
      aRun(pullRequest.id, { kind: 'trial', status: 'completed', chainId: null }),
    );
    await addRunCost(db, trial.id, 4);
    await addRunCost(db, run.id, 3);
    await evaluateAlerts(deps);
    expect(await alertsWithKey(`cost:${pullRequest.id}`)).toEqual([]);

    // The live cost of the next turn passes the threshold mid-round.
    await addRunCost(db, run.id, 2.5);
    const crossed = await evaluateAlerts(deps);
    expect(
      crossed.fired.filter((a) => a.kind === 'cost' && a.pullRequestId === pullRequest.id),
    ).toMatchObject([
      {
        title: { code: 'alert_cost', params: { spentUsd: 5.5, maxUsd: 5 } },
        nextStep: { code: 'alert_next_split' },
      },
    ]);
    // The round goes on: nothing about the run changed.
    expect((await getRun(db, run.id))?.status).toBe('running');

    await addRunCost(db, run.id, 1);
    await db.update(schema.runs).set({ status: 'completed' }).where(eq(schema.runs.id, run.id));
    await evaluateAlerts(deps);
    const [alert] = await alertsWithKey(`cost:${pullRequest.id}`);
    expect(alert).toMatchObject({ status: 'active' });
    expect(await alertsWithKey(`cost:${pullRequest.id}`)).toHaveLength(1);
  });
});

describe('daily budget', () => {
  test('spend at 80% and then 100% creates two budget alerts, and midnight resolves them', async () => {
    await writeAppSettings(db, { ...DEFAULT_APP_SETTINGS, dailyBudgetUsd: 1000 });
    const { pullRequest } = await seedPullRequest(db);
    const run = await insertRun(db, aRun(pullRequest.id, { status: 'running' }));
    const stage = await insertStageExecution(db, {
      runId: run.id,
      stage: 'review',
      status: 'running',
    });
    const spend = (costUsd: number) =>
      insertAgentSession(db, {
        stageExecutionId: stage.id,
        role: 'reviewer',
        model: 'claude-opus-5-5',
        costUsd,
        costSource: 'reported',
        status: 'succeeded',
      });

    const now = new Date();
    const day = localDay(DEFAULT_APP_SETTINGS.timeZone, now);
    const spentNow = async () =>
      Number(
        (
          await db.execute<{ usd: string }>(
            sql`select coalesce(sum(cost_usd), 0) as usd from agent_sessions`,
          )
        ).rows[0]!.usd,
      );
    // Other tests in this file may have spent already; top up to 80% of the budget.
    await spend(800 - (await spentNow()));
    const at80 = await evaluateAlerts(deps, now);
    expect(at80.fired.filter((a) => a.kind === 'budget').map((a) => a.key)).toEqual([
      `budget:${day}:80`,
    ]);
    expect(at80.fired.find((a) => a.kind === 'budget')).toMatchObject({
      pullRequestId: null,
      clickupTaskId: 'WB-700',
      toGeneralTask: true,
    });

    await spend(200);
    const at100 = await evaluateAlerts(deps, now);
    expect(at100.fired.filter((a) => a.kind === 'budget').map((a) => a.key)).toEqual([
      `budget:${day}:100`,
    ]);

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const midnight = await evaluateAlerts(deps, tomorrow);
    expect(midnight.fired.filter((a) => a.kind === 'budget')).toEqual([]);
    expect(
      midnight.resolved.filter((a) => a.kind === 'budget').map((a) => [a.key, a.endNote?.code]),
    ).toEqual([
      [`budget:${day}:80`, 'alert_end_midnight'],
      [`budget:${day}:100`, 'alert_end_midnight'],
    ]);
    await writeAppSettings(db, DEFAULT_APP_SETTINGS);
  });
});

describe('when alerts are evaluated', () => {
  test('a run change asks for one evaluation', async () => {
    const listener = listenForAlertTriggers(deps, 20);
    await listener.ready;
    try {
      const jobs = () =>
        db.execute<{ n: number }>(
          sql`select count(*)::int as n from pgboss.job where name = 'alerts.evaluate'`,
        );
      const before = (await jobs()).rows[0]!.n;
      const { pullRequest } = await seedPullRequest(db);
      await insertRun(db, aRun(pullRequest.id));
      await expect
        .poll(async () => (await jobs()).rows[0]!.n, { timeout: 5000 })
        .toBeGreaterThan(before);
    } finally {
      await listener.close();
    }
  });
});
