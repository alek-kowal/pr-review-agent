// S-18-T4: each new alert becomes one ClickUp comment on the PR's task (else the general alerts
// task) with the next step, a link to the app and the bot's signature.
import { DEFAULT_ALERT_CONFIG, HAND, type RepositoryConfig } from '@pra/core';
import {
  eq,
  getAlert,
  insertRun,
  insertStageExecution,
  retryRun,
  schema,
  sql,
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
import { deliverAlert } from '../src/alerts/deliver.ts';
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

describe('deliverAlert', () => {
  test('one comment per alert lands on the PR task with the next step, the app link and the bot signature', async () => {
    const { pullRequest } = await failedPr('WB-123');
    const alert = await firedFor(pullRequest);
    expect(alert).toMatchObject({ clickupTaskId: 'WB-123', deliveryStatus: 'pending' });
    expect(await deliverJobs(alert.id)).toBe(1);

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

  test('a missing key sets "Not sent: ClickUp not configured"', async () => {
    deps.clickup = new FakeClickUpGateway({ unconfigured: true });
    const { pullRequest } = await failedPr('WB-125');
    const alert = await firedFor(pullRequest);
    expect(alert.deliveryStatus).toBe('not_configured');
    expect(await deliverJobs(alert.id)).toBe(0);

    // A pending alert whose key went missing before its job ran.
    await db
      .update(schema.alerts)
      .set({ deliveryStatus: 'pending' })
      .where(eq(schema.alerts.id, alert.id));
    expect(await deliverAlert(deps, alert.id)).toBe('not_configured');
    expect((await getAlert(db, alert.id))?.deliveryStatus).toBe('not_configured');
  });

  test('no app address: not configured either', async () => {
    const { pullRequest } = await failedPr('WB-126');
    const saved = deps.appBaseUrl;
    deps.appBaseUrl = null;
    try {
      const alert = await firedFor(pullRequest);
      expect(alert.deliveryStatus).toBe('not_configured');
    } finally {
      deps.appBaseUrl = saved;
    }
    expect(clickup.callsOf('createComment')).toEqual([]);
  });

  test('a job delivered twice posts once', async () => {
    const { pullRequest } = await failedPr('WB-127');
    const alert = await firedFor(pullRequest);
    await sendAlertDelivery(deps.queue, alert.id);
    expect(await deliverJobs(alert.id)).toBe(1);
    expect(await deliverAlert(deps, alert.id)).toBe('sent');
    expect(await deliverAlert(deps, alert.id)).toBe('already_sent');
    expect(clickup.callsOf('createComment')).toHaveLength(1);
  });

  test('a ClickUp error marks the alert failed and throws, so the job retries', async () => {
    const { pullRequest } = await failedPr('WB-128');
    const alert = await firedFor(pullRequest);
    clickup.failNext('createComment', Object.assign(new Error('boom'), { code: 'clickup_error' }));
    await expect(deliverAlert(deps, alert.id)).rejects.toThrow('boom');
    expect((await getAlert(db, alert.id))?.deliveryStatus).toBe('failed');
    expect(await deliverAlert(deps, alert.id)).toBe('sent');
  });
});
