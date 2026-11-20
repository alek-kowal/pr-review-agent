// S-18-T4: each new alert becomes one ClickUp comment on the PR's task (else the general alerts
// task) with the next step, a link to the app and the bot's signature.
// ALERTTL: the PR timeline says how the comment went only after the attempt, with the reason.
import { DEFAULT_ALERT_CONFIG, HAND, type RepositoryConfig } from '@pra/core';
import {
  eq,
  getAlert,
  insertRun,
  insertStageExecution,
  QUEUE_SETTINGS,
  retryRun,
  schema,
  sql,
  timelineOf,
  upsertPullRequest,
  upsertTaskLink,
  writeAlertConfig,
  type Db,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { FakeClickUpGateway } from '@pra/integrations/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { deliverAlert, FIRST_ATTEMPT, handleAlertDeliveries } from '../src/alerts/deliver.ts';
import { evaluateAlerts, sendAlertDelivery } from '../src/alerts/evaluate.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

const CLICKUP: RepositoryConfig['clickup'] = {
  workspaceId: '9012',
  spaceId: null,
  followUpListId: null,
  taskIdPattern: 'WB-\\d+',
};

// Alerts and their config are app-wide: this file uses its own database.
let database: TestDatabase;
let deps: TestWorkerDeps;
let db: Db;
let repository: Repository;
let clickup: FakeClickUpGateway;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url, appBaseUrl: 'https://pra.example/' });
  db = deps.db;
  repository = await connectRepository(db, { clickup: CLICKUP });
  await writeAlertConfig(db, { ...DEFAULT_ALERT_CONFIG, generalTaskId: 'WB-700' });
});
afterAll(async () => {
  await deps.close();
  await database.drop();
});
beforeEach(() => {
  clickup = new FakeClickUpGateway();
  deps.clickup = clickup;
});

let nextNumber = 300;

async function failedPr(
  taskId: string | null,
): Promise<{ pullRequest: PullRequest; runId: number }> {
  const { pullRequest } = await upsertPullRequest(
    db,
    aPullRequest(repository.id, { number: nextNumber++ }),
  );
  if (taskId) {
    await upsertTaskLink(db, {
      pullRequestId: pullRequest.id,
      taskId,
      url: `https://app.clickup.com/t/${taskId}`,
      name: 'Rename edge labels inline',
      how: 'branch',
      linkedBy: 'bot',
    });
  }
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'failed' }));
  await insertStageExecution(db, {
    runId: run.id,
    stage: 'review',
    status: 'failed',
    errorCode: 'stage_timeout',
  });
  return { pullRequest, runId: run.id };
}

async function firedFor(pullRequest: PullRequest) {
  const { fired } = await evaluateAlerts(deps);
  const alert = fired.find((a) => a.pullRequestId === pullRequest.id);
  if (!alert) throw new Error('no alert fired');
  return alert;
}

const deliverJobs = async (alertId: number) =>
  (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job
          where name = 'alerts.deliver' and data->>'alertId' = ${String(alertId)}`,
    )
  ).rows[0]!.n;

const timelineKinds = async (pullRequest: PullRequest) =>
  (await timelineOf(db, pullRequest.id))
    .filter((e) => e.kind.startsWith('alert_'))
    .map((e) => e.kind);

/** The params of the PR's `alert_delivery` timeline entries, oldest first. */
const deliveryEntries = async (pullRequest: PullRequest) =>
  (await timelineOf(db, pullRequest.id))
    .filter((e) => e.kind === 'alert_delivery')
    .map((e) => e.params as Record<string, unknown>);

/** A delivery job as pg-boss hands it over with `includeMetadata`. */
const jobOf = (alertId: number, attempt: { retryCount: number; retryLimit: number }) =>
  ({ id: `job-${alertId}`, name: 'alerts.deliver', data: { alertId }, ...attempt }) as Parameters<
    typeof handleAlertDeliveries
  >[1][number];

describe('deliverAlert', () => {
  test('one comment per alert lands on the PR task with the next step, the app link and the bot signature', async () => {
    const { pullRequest } = await failedPr('WB-123');
    const alert = await firedFor(pullRequest);
    expect(alert).toMatchObject({
      clickupTaskId: 'WB-123',
      deliveryStatus: 'pending',
      deliveryReason: null,
    });
    expect(await deliverJobs(alert.id)).toBe(1);
    // Before the attempt the timeline has the alert only, with no claim about ClickUp.
    expect(await timelineKinds(pullRequest)).toEqual(['alert_raised']);
    const [raised] = await timelineOf(db, pullRequest.id);
    expect(raised!.params).not.toHaveProperty('taskId');

    expect(await deliverAlert(deps, alert.id)).toBe('sent');
    const calls = clickup.callsOf('createComment');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.taskId).toBe('WB-123');
    expect(calls[0]!.text).toBe(
      [
        `PR Review Agent alert · PR #${pullRequest.number}`,
        'Review stage timed out after 30 min.',
        'Next step: Retry from Review.',
        `Open in PR Review Agent: https://pra.example/pr/${repository.slug}/${pullRequest.number}`,
        '— pr-review-agent',
      ].join('\n'),
    );
    expect(await getAlert(db, alert.id)).toMatchObject({
      deliveryStatus: 'sent',
      commentId: expect.any(String),
      postedAt: expect.any(Date),
    });
    // After it: sent, and on which task.
    expect(await deliveryEntries(pullRequest)).toEqual([
      {
        alertId: alert.id,
        alertKind: 'failed',
        title: alert.title,
        status: 'sent',
        taskId: 'WB-123',
        toGeneralTask: false,
        reason: null,
      },
    ]);
  });

  test('an alert for a PR without a task goes to the general task', async () => {
    const { pullRequest } = await failedPr(null);
    const alert = await firedFor(pullRequest);
    expect(alert).toMatchObject({ clickupTaskId: 'WB-700', toGeneralTask: true });
    await deliverAlert(deps, alert.id);
    expect(clickup.callsOf('createComment').map((c) => c.taskId)).toEqual(['WB-700']);
  });

  test('a clear posts nothing', async () => {
    const { pullRequest, runId } = await failedPr('WB-124');
    const alert = await firedFor(pullRequest);
    await deliverAlert(deps, alert.id);
    const jobsBefore = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pgboss.job where name = 'alerts.deliver'`,
      )
    ).rows[0]!.n;

    await retryRun({ db, queue: deps.queue }, runId, HAND);
    const { resolved } = await evaluateAlerts(deps);
    expect(resolved.map((a) => a.id)).toContain(alert.id);
    expect(clickup.callsOf('createComment')).toHaveLength(1);
    const jobsAfter = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pgboss.job where name = 'alerts.deliver'`,
      )
    ).rows[0]!.n;
    expect(jobsAfter).toBe(jobsBefore);
    // Delivering the cleared alert again still posts nothing new.
    expect(await deliverAlert(deps, alert.id)).toBe('already_sent');
  });

  test('a missing key: not sent, and the reason names the key', async () => {
    deps.clickup = new FakeClickUpGateway({ unconfigured: true });
    const { pullRequest } = await failedPr('WB-125');
    const alert = await firedFor(pullRequest);
    const noKey = { code: 'alert_delivery_no_key', params: { missing: ['CLICKUP_API_KEY'] } };
    expect(alert).toMatchObject({ deliveryStatus: 'not_configured', deliveryReason: noKey });
    expect(await deliverJobs(alert.id)).toBe(0);
    // No job runs, so the timeline says it at once.
    expect(await deliveryEntries(pullRequest)).toEqual([
      expect.objectContaining({ alertId: alert.id, status: 'not_sent', reason: noKey }),
    ]);

    // A pending alert whose key went missing before its job ran: the same entry, not a second.
    await db
      .update(schema.alerts)
      .set({ deliveryStatus: 'pending', deliveryReason: null })
      .where(eq(schema.alerts.id, alert.id));
    expect(await deliverAlert(deps, alert.id)).toBe('not_configured');
    expect(await getAlert(db, alert.id)).toMatchObject({
      deliveryStatus: 'not_configured',
      deliveryReason: noKey,
    });
    expect(await deliveryEntries(pullRequest)).toHaveLength(1);
  });

  test('no app address: not sent, with that reason', async () => {
    const { pullRequest } = await failedPr('WB-126');
    const saved = deps.appBaseUrl;
    deps.appBaseUrl = null;
    try {
      const alert = await firedFor(pullRequest);
      const noUrl = { code: 'alert_delivery_no_app_url', params: {} };
      expect(alert).toMatchObject({ deliveryStatus: 'not_configured', deliveryReason: noUrl });
      expect(await deliveryEntries(pullRequest)).toEqual([
        expect.objectContaining({ status: 'not_sent', reason: noUrl }),
      ]);
    } finally {
      deps.appBaseUrl = saved;
    }
    expect(clickup.callsOf('createComment')).toEqual([]);
  });

  test('no task for the PR and no general task: not sent, with that reason', async () => {
    await writeAlertConfig(db, DEFAULT_ALERT_CONFIG);
    try {
      const { pullRequest } = await failedPr(null);
      const alert = await firedFor(pullRequest);
      const noTask = { code: 'alert_delivery_no_task', params: { forPr: true } };
      expect(alert).toMatchObject({
        clickupTaskId: null,
        deliveryStatus: 'not_configured',
        deliveryReason: noTask,
      });
      expect(await deliverJobs(alert.id)).toBe(0);
      expect(await timelineKinds(pullRequest)).toEqual(['alert_raised', 'alert_delivery']);
      expect(await deliveryEntries(pullRequest)).toEqual([
        expect.objectContaining({ status: 'not_sent', taskId: null, reason: noTask }),
      ]);
    } finally {
      await writeAlertConfig(db, { ...DEFAULT_ALERT_CONFIG, generalTaskId: 'WB-700' });
    }
    expect(clickup.callsOf('createComment')).toEqual([]);
  });

  test('no repository with ClickUp set up: not sent, with that reason', async () => {
    const { pullRequest } = await failedPr('WB-129');
    const alert = await firedFor(pullRequest);
    const stored = await db.select().from(schema.repositories);
    await db.update(schema.repositories).set({
      config: sql`jsonb_set(${schema.repositories.config}, '{clickup}', 'null'::jsonb)`,
    });
    try {
      expect(await deliverAlert(deps, alert.id)).toBe('not_configured');
    } finally {
      for (const row of stored) {
        await db
          .update(schema.repositories)
          .set({ config: row.config })
          .where(eq(schema.repositories.id, row.id));
      }
    }
    const off = { code: 'alert_delivery_clickup_off', params: {} };
    expect(await getAlert(db, alert.id)).toMatchObject({
      deliveryStatus: 'not_configured',
      deliveryReason: off,
    });
    expect(await deliveryEntries(pullRequest)).toEqual([
      expect.objectContaining({ status: 'not_sent', reason: off }),
    ]);
    expect(clickup.callsOf('createComment')).toEqual([]);
  });

  test('a job delivered twice posts once and writes one timeline entry', async () => {
    const { pullRequest } = await failedPr('WB-127');
    const alert = await firedFor(pullRequest);
    await sendAlertDelivery(deps.queue, alert.id);
    expect(await deliverJobs(alert.id)).toBe(1);
    expect(await deliverAlert(deps, alert.id)).toBe('sent');
    expect(await deliverAlert(deps, alert.id)).toBe('already_sent');
    expect(clickup.callsOf('createComment')).toHaveLength(1);
    expect((await deliveryEntries(pullRequest)).map((e) => e.status)).toEqual(['sent']);
  });

  test('a failed attempt with retries left says so once, then the retry says sent', async () => {
    const { pullRequest } = await failedPr('WB-128');
    const alert = await firedFor(pullRequest);
    const boom = () => Object.assign(new Error('boom'), { code: 'clickup_error' });
    const failedAt = (attempt: number) => ({
      code: 'alert_delivery_failed',
      params: { willRetry: true, attempt, attempts: 6, errorCode: 'clickup_error' },
    });

    // The first run of the job: the queue's own retry limit.
    expect(FIRST_ATTEMPT).toEqual({
      retryCount: 0,
      retryLimit: QUEUE_SETTINGS['alerts.deliver']!.retryLimit,
    });
    clickup.failNext('createComment', boom());
    await expect(deliverAlert(deps, alert.id)).rejects.toThrow('boom');
    expect(await getAlert(db, alert.id)).toMatchObject({
      deliveryStatus: 'failed',
      deliveryReason: failedAt(1),
    });
    expect(await deliveryEntries(pullRequest)).toEqual([
      expect.objectContaining({ status: 'failed', taskId: 'WB-128', reason: failedAt(1) }),
    ]);

    // The retried job fails again: the alert knows the attempt, the timeline adds nothing.
    clickup.failNext('createComment', boom());
    await expect(
      handleAlertDeliveries(deps, [jobOf(alert.id, { retryCount: 1, retryLimit: 5 })]),
    ).rejects.toThrow('boom');
    expect((await getAlert(db, alert.id))?.deliveryReason).toEqual(failedAt(2));
    expect(await deliveryEntries(pullRequest)).toHaveLength(1);

    // The next retry succeeds.
    await handleAlertDeliveries(deps, [jobOf(alert.id, { retryCount: 2, retryLimit: 5 })]);
    expect(await getAlert(db, alert.id)).toMatchObject({
      deliveryStatus: 'sent',
      deliveryReason: null,
    });
    expect((await deliveryEntries(pullRequest)).map((e) => e.status)).toEqual(['failed', 'sent']);
  });

  test('the last attempt failing says nothing will retry it', async () => {
    const { pullRequest } = await failedPr('WB-130');
    const alert = await firedFor(pullRequest);
    const boom = () => Object.assign(new Error('boom'), { code: 'clickup_error' });
    clickup.failNext('createComment', boom());
    await expect(deliverAlert(deps, alert.id)).rejects.toThrow('boom');
    clickup.failNext('createComment', boom());
    await expect(
      handleAlertDeliveries(deps, [jobOf(alert.id, { retryCount: 5, retryLimit: 5 })]),
    ).rejects.toThrow('boom');

    const final = {
      code: 'alert_delivery_failed',
      params: { willRetry: false, attempt: 6, attempts: 6, errorCode: 'clickup_error' },
    };
    expect(await getAlert(db, alert.id)).toMatchObject({
      deliveryStatus: 'failed',
      deliveryReason: final,
    });
    expect((await deliveryEntries(pullRequest)).map((e) => e.reason)).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ willRetry: true }) }),
      final,
    ]);
  });
});
