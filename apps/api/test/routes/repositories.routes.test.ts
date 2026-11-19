// S-20-T3: connecting and configuring repositories in Settings, with a GitHubGateway double.
import {
  closeDb,
  createDb,
  createQueue,
  eq,
  getRepositoryByFullName,
  listSettingsChanges,
  schema,
  sql,
  upsertRepository,
  type Queue,
} from '@pra/db';
import { seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import { LocalBlobStore } from '@pra/integrations';
import { FakeGitHubGateway, githubFixture, signWebhook } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  RepositoriesSettingsResponse,
  slugFor,
} from '../../src/routes/api/settings/repositories/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const SECRET = 'repositories-webhook-secret';
const db = createDb(testDatabaseUrl(), { max: 3 });
let queue: Queue;
let blobDir: string;
let signer: { id: string };

beforeAll(async () => {
  // Started (to send), but no worker subscribes in api tests.
  queue = createQueue(testDatabaseUrl(), { supervise: false, schedule: false, max: 2 });
  queue.on('error', () => {});
  await queue.start();
  blobDir = await mkdtemp(path.join(tmpdir(), 'pra-repositories-'));
  signer = await seedTeamMember(db, { name: 'Tomek' });
});

afterAll(async () => {
  await queue.stop({ graceful: false });
  await closeDb(db);
  await rm(blobDir, { recursive: true, force: true });
});

/** Names unique to one test, since api test files share a database. */
let wb: string;
let second: string;
let third: string;
let github: FakeGitHubGateway;
let app: FastifyInstance;

beforeEach(async () => {
  const id = uniqueId();
  wb = `synergycodes-${id}/workflowbuilder`;
  second = `acme-${id}/second-repo`;
  third = `acme-${id}/third-repo`;
  github = new FakeGitHubGateway({
    webhookSecret: SECRET,
    installations: { [wb]: 1, [second]: 2, [third]: 2 },
  });
  github.repositoryDetails.set(second, { defaultBranch: 'develop', private: true });
  await upsertRepository(db, { slug: `wb-${id}`, githubFullName: wb }, { installationId: 1 });
  app = await build({ db, queue, github, blobStore: new LocalBlobStore(blobDir) });
});

const settings = (patch: Record<string, unknown> = {}) => ({
  defaultBranch: 'develop',
  defaultLevel: 2,
  fetchCommand: null,
  installCommand: null,
  clickup: null,
  sensitivePatterns: [{ pattern: 'db/migrations/**', reason: 'Migrations cannot be undone.' }],
  changeTypeRules: {
    usesExistingPaths: ['**/*.md'],
    oneWayPaths: ['src/index.ts'],
    sizeLines: 300,
  },
  largePrLines: 1200,
  ...patch,
});

const send = (method: 'POST' | 'PUT', url: string, payload: object) =>
  app.inject({ method, url, headers: SAME_ORIGIN, payload });

const connect = (fullName: string, config = settings(), signedBy: string | null = signer.id) =>
  send('POST', '/api/settings/repositories', {
    fullName,
    config,
    ...(signedBy ? { signedBy } : {}),
  });

describe('GET /api/settings/repositories', () => {
  test('lists connected repositories with their config, and the reachable ones not connected', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings/repositories' });

    expect(response.statusCode).toBe(200);
    const body = RepositoriesSettingsResponse.parse(response.json());
    expect(body.repositories.find((r) => r.githubFullName === wb)).toMatchObject({
      installationId: 1,
      config: { githubFullName: wb, defaultLevel: 1 },
    });
    expect(body.available.map((r) => r.fullName)).toEqual([second, third]);
    expect(body.available[0]).toMatchObject({
      defaultBranch: 'develop',
      private: true,
      installationId: 2,
    });
    expect(body.availableError).toBeNull();
  });
});

describe('POST /api/settings/repositories', () => {
  test('connecting acme/second-repo writes its config and one settings change', async () => {
    const response = await connect(second);

    expect(response.statusCode).toBe(201);
    const { repository } = response.json<{ repository: { id: number; slug: string } }>();
    const stored = await getRepositoryByFullName(db, second);
    expect(stored).toMatchObject({ id: repository.id, installationId: 2, githubFullName: second });
    expect(stored!.config).toMatchObject({
      ...settings(),
      githubFullName: second,
      slug: repository.slug,
    });
    const changes = await listSettingsChanges(db, {
      area: 'repositories',
      entity: String(repository.id),
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      signerId: signer.id,
      before: null,
      after: { githubFullName: second },
    });

    const listed = RepositoriesSettingsResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/settings/repositories' })).json(),
    );
    expect(listed.available.map((r) => r.fullName)).toEqual([third]);
  });

  test('an invalid glob returns 400 and connects nothing', async () => {
    const response = await connect(
      second,
      settings({
        changeTypeRules: { usesExistingPaths: ['docs/[a-z].md'], oneWayPaths: [], sizeLines: 300 },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'invalid_request',
        params: {
          issues: [{ path: '/config/changeTypeRules/usesExistingPaths/0', code: 'invalid_glob' }],
        },
      },
    });
    expect(await getRepositoryByFullName(db, second)).toBeNull();
  });

  test('a sensitive file without a reason returns 400', async () => {
    const response = await connect(
      second,
      settings({ sensitivePatterns: [{ pattern: 'db/**', reason: ' ' }] }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { params: { issues: [{ path: '/config/sensitivePatterns/0/reason' }] } },
    });
  });

  test('connecting a repository the App cannot reach returns 404', async () => {
    const response = await connect('acme/elsewhere');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'repository_not_reachable', params: { fullName: 'acme/elsewhere' } },
    });
  });

  test('an unsigned connect is refused, and a connected repository cannot connect again', async () => {
    expect((await connect(second, settings(), null)).json()).toMatchObject({
      error: { code: 'signature_required' },
    });
    expect(await getRepositoryByFullName(db, second)).toBeNull();

    expect((await connect(wb)).statusCode).toBe(409);
  });

  test('a webhook for the new repository after connecting is accepted for the worker', async () => {
    expect((await connect(second)).statusCode).toBe(201);
    const fixture = githubFixture('pull_request.ready_for_review');
    const payload = structuredClone(fixture.payload) as {
      repository: { full_name: string };
      pull_request: {
        number: number;
        base: { repo: { full_name: string } };
        head: { repo: { full_name: string } };
      };
    };
    payload.repository.full_name = second;
    payload.pull_request.number = 12;
    payload.pull_request.base.repo.full_name = second;
    payload.pull_request.head.repo.full_name = second;
    const body = JSON.stringify(payload);
    const deliveryId = `delivery-${uniqueId()}`;

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signWebhook(body, SECRET),
      },
      payload: body,
    });

    // The worker reads the repository on every event (apps/worker/test/github-event.test.ts).
    expect(response.statusCode).toBe(202);
    const [event] = await db
      .select()
      .from(schema.githubEvents)
      .where(eq(schema.githubEvents.deliveryId, deliveryId));
    expect(event).toMatchObject({ repositoryFullName: second, prNumber: 12 });
    const jobs = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from pgboss.job
          where name = 'github.event' and (data->>'eventId')::int = ${event!.id}`,
    );
    expect(jobs.rows[0]!.count).toBe(1);
  });
});

describe('GET and PUT /api/settings/repositories/:id', () => {
  test('a signed edit writes the config and one change; slug and full name stay', async () => {
    const { repository } = (await connect(second)).json<{
      repository: { id: number; slug: string };
    }>();
    const url = `/api/settings/repositories/${repository.id}`;
    const before = (await app.inject({ method: 'GET', url })).json<{
      repository: { config: object };
    }>().repository.config;

    const response = await send('PUT', url, {
      config: settings({ defaultLevel: 3, slug: 'other', githubFullName: 'x/y' }),
      before,
      signedBy: signer.id,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repository: {
        slug: repository.slug,
        githubFullName: second,
        config: { defaultLevel: 3, slug: repository.slug },
      },
    });
    const changes = await listSettingsChanges(db, {
      area: 'repositories',
      entity: String(repository.id),
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ before: { defaultLevel: 2 }, after: { defaultLevel: 3 } });
  });

  test('a stale before returns 409 and writes nothing', async () => {
    const { repository } = (await connect(second)).json<{ repository: { id: number } }>();
    const url = `/api/settings/repositories/${repository.id}`;
    const seen = (await app.inject({ method: 'GET', url })).json<{
      repository: { config: object };
    }>().repository.config;
    expect(
      (await send('PUT', url, { config: settings({ defaultLevel: 3 }), signedBy: signer.id }))
        .statusCode,
    ).toBe(200);

    const stale = await send('PUT', url, {
      config: settings({ defaultLevel: 4 }),
      before: seen,
      signedBy: signer.id,
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'settings_stale' } });
    expect((await getRepositoryByFullName(db, second))!.config).toMatchObject({ defaultLevel: 3 });
  });

  test('an unknown repository is 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings/repositories/999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'repository_not_found' } });
  });
});

test('slugFor takes the name, and the owner too when the name is taken', () => {
  expect(slugFor('acme/Second.Repo', new Set())).toBe('second-repo');
  expect(slugFor('acme/second-repo', new Set(['second-repo']))).toBe('acme-second-repo');
  expect(slugFor('acme/second-repo', new Set(['second-repo', 'acme-second-repo']))).toBe(
    'acme-second-repo-2',
  );
});
