// S-20-T6: Settings → Integrations status, the ClickUp connection test and the comment switch.
import {
  closeDb,
  createDb,
  getAppSettings,
  insertRun,
  listSettingsChanges,
  recordGithubEvent,
  schema,
  type Db,
} from '@pra/db';
import {
  aRun,
  createTestDatabase,
  seedPullRequest,
  seedTeamMember,
  uniqueId,
  type TestDatabase,
} from '@pra/db/testing';
import {
  CLICKUP_AUTH_FAILED,
  createClickUpGateway,
  createGitHubGateway,
  IntegrationError,
} from '@pra/integrations';
import {
  FakeClickUpGateway,
  FakeGitHubGateway,
  githubFixture,
  signWebhook,
} from '@pra/integrations/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  ClickUpTestResponse,
  IntegrationsResponse,
} from '../../src/routes/api/settings/integrations/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const URL = '/api/settings/integrations';

// Its own database: delivery counts and the app settings row are global, and api test files
// otherwise share one database.
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

async function status(deps: Parameters<typeof build>[0] = {}) {
  const app = await build({ db, ...deps });
  const response = await app.inject({ method: 'GET', url: URL });
  expect(response.statusCode).toBe(200);
  return IntegrationsResponse.parse(response.json());
}

describe('GET /api/settings/integrations', () => {
  test('without credentials both integrations read "not configured", with no call made', async () => {
    const body = await status({
      github: createGitHubGateway({}),
      clickup: createClickUpGateway({}),
    });

    expect(body.github).toMatchObject({
      configured: false,
      installations: [],
      repositories: [],
      listError: null,
      lastReconcilePoll: null,
    });
    expect(body.github.missing).toEqual(
      expect.arrayContaining(['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET']),
    );
    expect(body.clickup).toMatchObject({ configured: false, missing: ['CLICKUP_API_KEY'] });
  });

  test('lists the installations and the repositories the App can act on', async () => {
    const github = new FakeGitHubGateway({
      installations: { 'acme/one': 7, 'acme/two': 7, 'beta/three': 9 },
    });

    const body = await status({ github });

    expect(body.github.configured).toBe(true);
    expect(body.github.installations).toEqual([
      { id: 7, account: 'acme', repositoryCount: 2 },
      { id: 9, account: 'beta', repositoryCount: 1 },
    ]);
    expect(body.github.repositories.map((r) => r.fullName).sort()).toEqual([
      'acme/one',
      'acme/two',
      'beta/three',
    ]);
  });

  test('delivery counts match the stored GitHub events and refused signatures', async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const event = (receivedAt: Date) => ({
      deliveryId: `delivery-${uniqueId()}`,
      event: 'pull_request',
      action: 'opened',
      repositoryFullName: 'acme/one',
      prNumber: 1,
      blobKey: `github-events/${uniqueId()}.json`,
      receivedAt,
    });
    await recordGithubEvent(db, event(twoDaysAgo));
    await recordGithubEvent(db, event(hourAgo));
    const { event: newest } = await recordGithubEvent(db, event(new Date()));

    const github = new FakeGitHubGateway();
    const app = await build({ db, github });
    const payload = JSON.stringify(githubFixture('ping'));
    for (let i = 0; i < 2; i++) {
      const refused = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'ping',
          'x-github-delivery': `bad-${uniqueId()}`,
          'x-hub-signature-256': signWebhook(payload, 'not-the-secret'),
        },
        payload,
      });
      expect(refused.statusCode).toBe(401);
    }
    const response = await app.inject({ method: 'GET', url: URL });
    const body = IntegrationsResponse.parse(response.json());

    expect(body.github.deliveries).toMatchObject({
      last24h: 2,
      signatureFailures24h: 2,
      last: { deliveryId: newest.deliveryId, event: 'pull_request', action: 'opened' },
    });
    expect(body.github.deliveries.lastSignatureFailureAt).not.toBeNull();
  });

  test('the last ClickUp call is the newest Task stage that reached ClickUp', async () => {
    const { pullRequest } = await seedPullRequest(db, {
      repository: { slug: `clickup-${uniqueId()}` },
    });
    const run = await insertRun(db, aRun(pullRequest.id));
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const reached = at(20);
    await db.insert(schema.stageExecutions).values([
      {
        runId: run.id,
        stage: 'task',
        attempt: 1,
        status: 'failed',
        finishedAt: at(30),
        errorCode: 'clickup_auth_failed',
      },
      {
        runId: run.id,
        stage: 'task',
        attempt: 2,
        status: 'succeeded',
        finishedAt: reached,
        output: { status: 'no_task' },
      },
      // Newest, but no call was made: a repository without ClickUp.
      {
        runId: run.id,
        stage: 'task',
        attempt: 3,
        status: 'succeeded',
        finishedAt: at(10),
        output: { status: 'not_configured' },
      },
    ]);

    const body = await status();

    expect(body.clickup).toEqual({
      configured: true,
      missing: [],
      lastCall: { ok: true, error: null, at: reached.toISOString() },
    });
  });
});

describe('POST /api/settings/integrations/clickup/test', () => {
  const test_ = (clickup: FakeClickUpGateway | ReturnType<typeof createClickUpGateway>) =>
    build({ db, clickup }).then((app) =>
      app.inject({ method: 'POST', url: `${URL}/clickup/test`, headers: SAME_ORIGIN }),
    );

  test('answers with the ClickUp user when the key works', async () => {
    const response = await test_(new FakeClickUpGateway());

    expect(response.statusCode).toBe(200);
    expect(ClickUpTestResponse.parse(response.json())).toMatchObject({ ok: true });
  });

  test("the double's 401 comes back as the error", async () => {
    const clickup = new FakeClickUpGateway().failNext(
      'whoAmI',
      new IntegrationError(CLICKUP_AUTH_FAILED),
    );

    const response = await test_(clickup);

    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'clickup_auth_failed', params: {} },
    });
  });

  test('without the key it reports not configured, never a success', async () => {
    const response = await test_(createClickUpGateway({}));

    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'clickup_not_configured', params: { missing: ['CLICKUP_API_KEY'] } },
    });
  });
});

describe('PUT /api/settings/integrations', () => {
  test('the comment switch writes the app settings and one settings change', async () => {
    const signer = await seedTeamMember(db);
    const app = await build({ db });

    const response = await app.inject({
      method: 'PUT',
      url: URL,
      headers: SAME_ORIGIN,
      payload: {
        afterRoundGithubComment: false,
        before: { afterRoundGithubComment: true },
        signedBy: signer.id,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ settings: { afterRoundGithubComment: false } });
    expect((await getAppSettings(db)).value.afterRoundGithubComment).toBe(false);
    const changes = await listSettingsChanges(db, { area: 'integrations' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entity: 'app',
      before: { afterRoundGithubComment: true },
      after: { afterRoundGithubComment: false },
      actor: 'member',
      signerId: signer.id,
    });

    // The settings the signer saw changed in between.
    const stale = await app.inject({
      method: 'PUT',
      url: URL,
      headers: SAME_ORIGIN,
      payload: {
        afterRoundGithubComment: true,
        before: { afterRoundGithubComment: true },
        signedBy: signer.id,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'settings_stale' } });
  });

  test('an unsigned switch is refused', async () => {
    const app = await build({ db });

    const response = await app.inject({
      method: 'PUT',
      url: URL,
      headers: SAME_ORIGIN,
      payload: { afterRoundGithubComment: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'signature_required' } });
  });
});
