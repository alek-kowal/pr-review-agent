// S-18-T5: the alerts API. Active and past lists, Dismiss (by hand, with a timeline entry), the
// board's `alertCount`, the PR view's `alerts` section and the status chip's count. Own database:
// the counts are over every alert.
import { reason } from '@pra/core';
import {
  closeDb,
  createDb,
  insertAlert,
  insertRun,
  resolveAlerts,
  timelineOf,
  type Db,
  type NewAlert,
} from '@pra/db';
import { aRun, createTestDatabase, seedPullRequest, type TestDatabase } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { BoardResponse } from '../../src/board/board.ts';
import { PrViewSchema } from '../../src/pr-view/index.ts';
import { AlertsResponse, DismissResponse } from '../../src/routes/api/alerts/index.ts';
import { StatusResponse } from '../../src/routes/api/status/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

let database: TestDatabase;
let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
}, 30_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.drop();
});

const anAlert = (overrides: Partial<NewAlert> & Pick<NewAlert, 'key'>): NewAlert => ({
  kind: 'cost',
  pullRequestId: null,
  title: reason('alert_cost', { prNumber: 1, spentUsd: 6, maxUsd: 5 }),
  nextStep: reason('alert_next_split'),
  clickupTaskId: null,
  toGeneralTask: false,
  ...overrides,
});

async function seedAlerts() {
  const { repository, pullRequest } = await seedPullRequest(db, {
    repository: { slug: 'alerts-api' },
    pullRequest: { number: 41 },
  });
  const failedRun = await insertRun(db, aRun(pullRequest.id, { status: 'failed' }));
  const failed = await insertAlert(
    db,
    anAlert({
      kind: 'failed',
      key: `failed:${pullRequest.id}:${failedRun.id}`,
      pullRequestId: pullRequest.id,
      runId: failedRun.id,
      title: reason('alert_failed', {
        prNumber: 41,
        stage: 'review',
        errorCode: 'timeout',
        timeoutMinutes: 20,
      }),
      nextStep: reason('alert_next_retry', { stage: 'review' }),
      clickupTaskId: 'WB-1',
    }),
  );
  const cost = await insertAlert(
    db,
    anAlert({ key: `cost:${pullRequest.id}`, pullRequestId: pullRequest.id }),
  );
  const budget = await insertAlert(
    db,
    anAlert({
      kind: 'budget',
      key: 'budget:2026-11-19:80',
      title: reason('alert_budget', { percent: 80, spentUsd: 16, budgetUsd: 20 }),
      nextStep: reason('alert_next_budget'),
      toGeneralTask: true,
      deliveryStatus: 'not_configured',
    }),
  );
  const cleared = await insertAlert(
    db,
    anAlert({
      kind: 'rounds',
      key: `rounds:${pullRequest.id}:1`,
      pullRequestId: pullRequest.id,
      title: reason('alert_rounds', { prNumber: 41, max: 3 }),
      nextStep: reason('alert_next_start_review'),
    }),
  );
  await resolveAlerts(db, [{ key: cleared!.key, note: reason('alert_end_new_review') }]);
  return { repository, pullRequest, failedRun, failed: failed!, cost: cost!, budget: budget! };
}

const list = async (status?: 'active' | 'past') => {
  const response = await app.inject({
    method: 'GET',
    url: status ? `/api/alerts?status=${status}` : '/api/alerts',
  });
  expect(response.statusCode).toBe(200);
  return AlertsResponse.parse(response.json());
};

const dismiss = (id: number) =>
  app.inject({ method: 'POST', url: `/api/alerts/${id}/dismiss`, headers: SAME_ORIGIN });

test('alerts: lists, dismiss by hand, board, PR view and status chip', async () => {
  app = await build({ db });
  const { repository, pullRequest, failedRun, failed, cost, budget } = await seedAlerts();

  // Active list: newest first, with the PR, the failed run for Retry and the delivery.
  const active = await list();
  expect(active.activeCount).toBe(3);
  expect(active.pastCount).toBe(1);
  expect(active.alerts.map((a) => a.id)).toEqual([budget.id, cost.id, failed.id]);
  const failedView = active.alerts.find((a) => a.id === failed.id)!;
  expect(failedView).toMatchObject({
    kind: 'failed',
    status: 'active',
    runId: failedRun.id,
    nextStep: { code: 'alert_next_retry', params: { stage: 'review' } },
    pullRequest: { repository: { slug: 'alerts-api' }, number: 41 },
    delivery: { status: 'pending', taskId: 'WB-1', toGeneralTask: false, postedAt: null },
  });
  expect(active.alerts.find((a) => a.id === budget.id)).toMatchObject({
    pullRequest: null,
    delivery: { status: 'not_configured', toGeneralTask: true },
  });

  // Past list: the cleared alert with its end note.
  const past = await list('past');
  expect(past.alerts).toHaveLength(1);
  expect(past.alerts[0]).toMatchObject({
    kind: 'rounds',
    status: 'resolved',
    endedBy: 'bot',
    endNote: { code: 'alert_end_new_review' },
  });

  // Board: one count per card.
  const boardResponse = await app.inject({ method: 'GET', url: '/api/board' });
  const board = BoardResponse.parse(boardResponse.json());
  const cards = [
    ...Object.values(board.lanes).flatMap((lane) => lane.cards),
    ...board.lanes.not_reviewed.drafts,
  ];
  expect(cards.find((c) => c.number === 41)?.alertCount).toBe(2);

  // PR view: the PR's active alerts.
  const prResponse = await app.inject({
    method: 'GET',
    url: `/api/prs/${repository.slug}/${pullRequest.number}`,
  });
  const prView = PrViewSchema.parse(prResponse.json());
  expect(prView.alerts.map((a) => a.id)).toEqual([cost.id, failed.id]);

  // Status chip: every active alert, the budget one too.
  const status = StatusResponse.parse((await app.inject({ url: '/api/status' })).json());
  expect(status.activeAlertCount).toBe(3);

  // Dismiss: by hand, into past alerts, with a timeline entry.
  const dismissed = await dismiss(cost.id);
  expect(dismissed.statusCode).toBe(200);
  expect(DismissResponse.parse(dismissed.json()).alert).toMatchObject({
    id: cost.id,
    status: 'dismissed',
    endedBy: 'hand',
    endNote: null,
    pullRequest: { number: 41 },
  });
  const timeline = await timelineOf(db, pullRequest.id);
  const entry = timeline.find((e) => e.kind === 'alert_dismissed');
  expect(entry).toMatchObject({
    actor: 'hand',
    sourceKey: `alert:${cost.id}:dismissed`,
    params: { alertId: cost.id, alertKind: 'cost' },
  });
  expect((await list()).activeCount).toBe(2);
  expect((await list('past')).alerts.map((a) => a.id)).toContain(cost.id);

  // A budget alert has no PR: dismissed without a timeline entry.
  expect((await dismiss(budget.id)).statusCode).toBe(200);

  // Twice, or unknown.
  const again = await dismiss(cost.id);
  expect(again.statusCode).toBe(409);
  expect(again.json()).toEqual({
    error: { code: 'alert_not_active', params: { id: cost.id, status: 'dismissed' } },
  });
  const unknown = await dismiss(999_999);
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json().error.code).toBe('alert_not_found');

  // A state-changing call without the request header is refused.
  const bare = await app.inject({ method: 'POST', url: `/api/alerts/${failed.id}/dismiss` });
  expect(bare.statusCode).toBe(403);
});
