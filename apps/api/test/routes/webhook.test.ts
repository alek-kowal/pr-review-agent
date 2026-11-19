import { closeDb, createDb, createQueue, eq, schema, sql, type Db, type Queue } from '@pra/db';
import { testDatabaseUrl } from '@pra/db/testing';
import { createGitHubGateway, LocalBlobStore } from '@pra/integrations';
import { FakeGitHubGateway, githubFixture, signWebhook } from '@pra/integrations/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { build } from '../helper.ts';

const SECRET = 'webhook-test-secret';
let db: Db;
let queue: Queue;
let blobDir: string;
let blobStore: LocalBlobStore;
const github = new FakeGitHubGateway({ webhookSecret: SECRET });

beforeAll(async () => {
  db = createDb(testDatabaseUrl(), { max: 2 });
  // Started (to send), but no worker subscribes in api tests.
  queue = createQueue(testDatabaseUrl(), { supervise: false, schedule: false, max: 2 });
  queue.on('error', () => {});
  await queue.start();
  blobDir = await mkdtemp(path.join(tmpdir(), 'pra-webhook-'));
  blobStore = new LocalBlobStore(blobDir);
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await closeDb(db);
  await rm(blobDir, { recursive: true, force: true });
});

const fixture = githubFixture('pull_request.ready_for_review');

function deliver(
  app: Awaited<ReturnType<typeof build>>,
  options: { deliveryId: string; signature?: string; body?: string },
) {
  const body = options.body ?? fixture.body;
  return app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: {
      'content-type': 'application/json',
      'x-github-event': fixture.event,
      'x-github-delivery': options.deliveryId,
      'x-hub-signature-256': options.signature ?? signWebhook(body, SECRET),
    },
    payload: body,
  });
}

const eventRows = (deliveryId: string) =>
  db.select().from(schema.githubEvents).where(eq(schema.githubEvents.deliveryId, deliveryId));

async function jobsFor(eventId: number): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from pgboss.job
        where name = 'github.event' and (data->>'eventId')::int = ${eventId}`,
  );
  return result.rows[0]!.count;
}

describe('POST /webhooks/github', () => {
  test('a signed delivery gives 202, the stored payload, one row and one queued job', async () => {
    const app = await build({ db, queue, github, blobStore });
    const deliveryId = randomUUID();

    const response = await deliver(app, { deliveryId });

    expect(response.statusCode).toBe(202);
    const { eventId } = response.json<{ eventId: number }>();
    const rows = await eventRows(deliveryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: eventId,
      event: 'pull_request',
      action: 'ready_for_review',
      repositoryFullName: 'synergycodes/workflowbuilder',
      prNumber: 312,
      blobKey: `github-events/${deliveryId}.json`,
      processedAt: null,
    });
    const blob = await blobStore.get(`github-events/${deliveryId}.json`);
    expect(Buffer.from(blob!.body).toString('utf8')).toBe(fixture.body);
    expect(await jobsFor(eventId)).toBe(1);
  });

  test('a bad signature gives 401 and stores nothing', async () => {
    const app = await build({ db, queue, github, blobStore });
    const deliveryId = randomUUID();

    const response = await deliver(app, {
      deliveryId,
      signature: signWebhook(fixture.body, 'another-secret'),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'webhook_signature_invalid', params: {} } });
    expect(await eventRows(deliveryId)).toHaveLength(0);
    expect(await blobStore.exists(`github-events/${deliveryId}.json`)).toBe(false);
  });

  test('a redelivery gives 202 with still one row and one job', async () => {
    const app = await build({ db, queue, github, blobStore });
    const deliveryId = randomUUID();

    const first = await deliver(app, { deliveryId });
    const second = await deliver(app, { deliveryId });

    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(await eventRows(deliveryId)).toHaveLength(1);
    expect(await jobsFor(first.json<{ eventId: number }>().eventId)).toBe(1);
  });

  test('a missing delivery id gives 400', async () => {
    const app = await build({ db, queue, github, blobStore });
    const response = await deliver(app, { deliveryId: '' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  test('without the webhook secret it answers 503 github_not_configured and stores nothing', async () => {
    const app = await build({ db, queue, github: createGitHubGateway({}), blobStore });
    const deliveryId = randomUUID();

    const response = await deliver(app, { deliveryId });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: 'github_not_configured',
      params: { missing: expect.arrayContaining(['GITHUB_WEBHOOK_SECRET']) },
    });
    expect(await eventRows(deliveryId)).toHaveLength(0);
  });

  test('needs no CSRF header (GitHub sends none)', async () => {
    const app = await build({ db, queue, github, blobStore });
    const response = await deliver(app, { deliveryId: randomUUID() });
    expect(response.statusCode).toBe(202);
  });
});
