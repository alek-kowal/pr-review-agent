// S-10-T4: signed pause, resume, daily budget and agent slots, and the status they read back.
import {
  closeDb,
  createDb,
  createQueue,
  getAppSettings,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  listSettingsChanges,
  sql,
  writeAppSettings,
  type Db,
  type Queue,
} from '@pra/db';
import { DEFAULT_APP_SETTINGS } from '@pra/core';
import {
  aRun,
  createTestDatabase,
  seedPullRequest,
  seedTeamMember,
  type TestDatabase,
} from '@pra/db/testing';
import { FakeGitHubGateway } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { StatusResponse } from '../../src/routes/api/status/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

// Its own database: the app settings row and the settings log are global.
let database: TestDatabase;
let db: Db;
let queue: Queue;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 3 });
  queue = createQueue(database.url, { supervise: false, schedule: false, max: 2 });
  queue.on('error', () => {});
  await queue.start();
}, 30_000);

afterAll(async () => {
  await queue.stop({ graceful: false });
  await closeDb(db);
  await database.drop();
});

beforeEach(async () => {
  await writeAppSettings(db, DEFAULT_APP_SETTINGS);
  await db.execute(sql`delete from settings_changes`);
  await db.execute(sql`delete from pgboss.job where name = 'run.drain'`);
});

const api = () => build({ db, queue });

function send(app: FastifyInstance, method: 'POST' | 'PUT', path: string, payload: object) {
  return app.inject({ method, url: `/api/status${path}`, headers: SAME_ORIGIN, payload });
}

async function drainJobs(): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from pgboss.job where name = 'run.drain'`,
  );
  return result.rows[0]!.count;
}

async function status(app: FastifyInstance) {
  const response = await app.inject({ method: 'GET', url: '/api/status' });
  expect(response.statusCode).toBe(200);
  return StatusResponse.parse(response.json());
}

describe('model access mode (P-25)', () => {
  test('the status names the mode it was started with, never a value', async () => {
    expect((await status(await api())).modelAuth).toBe('none');
    const app = await build({ db, queue, modelAuth: 'subscription' });
    const response = await app.inject({ method: 'GET', url: '/api/status' });
    expect(response.json()).toMatchObject({ modelAuth: 'subscription' });
    expect(response.body).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY/);
  });
});

describe('GitHub mode (P-28)', () => {
  test('the status says whether the App is connected or the app only polls', async () => {
    expect((await status(await api())).githubMode).toBe('app');
    const github = new FakeGitHubGateway().setMode('anonymous');
    expect((await status(await build({ db, queue, github }))).githubMode).toBe('anonymous');
  });
});

describe('every change needs a signature', () => {
  test.each([
    ['POST', '/pause', { reason: 'release freeze' }],
    ['POST', '/resume', {}],
    ['PUT', '/budget', { dailyBudgetUsd: 50 }],
    ['PUT', '/slots', { agentSlots: 3 }],
  ] as const)(
    '%s %s without a signer returns 400 and writes nothing',
    async (method, path, body) => {
      const app = await api();
      const response = await send(app, method, path, body);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: 'signature_required', params: {} } });
      expect(await listSettingsChanges(db, { area: 'budget' })).toEqual([]);
      expect(await drainJobs()).toBe(0);
    },
  );

  test('an unknown signer returns 400 signer_unknown', async () => {
    const app = await api();
    const response = await send(app, 'PUT', '/slots', {
      agentSlots: 3,
      signedBy: '00000000-0000-4000-8000-000000000099',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('signer_unknown');
  });
});

describe('pause and resume', () => {
  test('pause writes one entry and shows Paused by; pause twice 409; resume clears it', async () => {
    const tomek = await seedTeamMember(db, { name: 'Tomek' });
    const app = await api();
    expect((await status(app)).state).toBe('running');

    const paused = await send(app, 'POST', '/pause', {
      reason: 'release freeze',
      signedBy: tomek.id,
    });
    expect(paused.statusCode).toBe(200);
    expect(StatusResponse.parse(paused.json())).toMatchObject({
      state: 'paused',
      pausedBy: { id: tomek.id, name: 'Tomek' },
      pausedReason: 'release freeze',
    });
    expect((await status(app)).pausedAt).not.toBeNull();
    expect(await drainJobs()).toBe(1);
    const [pause] = await listSettingsChanges(db, { area: 'budget', entity: 'status' });
    expect(pause).toMatchObject({
      actor: 'member',
      signerId: tomek.id,
      before: { paused: false, reason: null, by: null },
      after: { paused: true, reason: 'release freeze', by: tomek.id },
    });

    const twice = await send(app, 'POST', '/pause', { reason: 'again', signedBy: tomek.id });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toEqual({ error: { code: 'already_paused', params: {} } });

    const resumed = await send(app, 'POST', '/resume', { signedBy: tomek.id });
    expect(resumed.statusCode).toBe(200);
    expect(StatusResponse.parse(resumed.json())).toMatchObject({
      state: 'running',
      pausedBy: null,
      pausedReason: null,
      pausedAt: null,
    });
    const changes = await listSettingsChanges(db, { area: 'budget', entity: 'status' });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      before: { paused: true, reason: 'release freeze', by: tomek.id },
      after: { paused: false, reason: null, by: null },
    });
    const settings = (await getAppSettings(db)).value;
    expect(settings).toMatchObject({ paused: false, pausedBy: null, pausedAt: null });

    const again = await send(app, 'POST', '/resume', { signedBy: tomek.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('not_paused');
  });
});

describe('daily budget and agent slots', () => {
  test('a budget change writes one entry with before and after; the spend reaches it', async () => {
    const kasia = await seedTeamMember(db, { name: 'Kasia' });
    const app = await api();

    const response = await send(app, 'PUT', '/budget', {
      dailyBudgetUsd: 50,
      before: { dailyBudgetUsd: null },
      signedBy: kasia.id,
    });

    expect(response.statusCode).toBe(200);
    expect(StatusResponse.parse(response.json())).toMatchObject({
      state: 'running',
      dailyBudgetUsd: 50,
      agentSlots: 2,
      timeZone: 'Europe/Warsaw',
    });
    const changes = await listSettingsChanges(db, { area: 'budget', entity: 'daily_budget' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      signerId: kasia.id,
      before: { dailyBudgetUsd: null },
      after: { dailyBudgetUsd: 50 },
    });
    expect(await drainJobs()).toBe(1);

    const stale = await send(app, 'PUT', '/budget', {
      dailyBudgetUsd: 10,
      before: { dailyBudgetUsd: null },
      signedBy: kasia.id,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('settings_stale');
  });

  test('agent slots: one entry; out of range is 400', async () => {
    const kasia = await seedTeamMember(db);
    const app = await api();

    const response = await send(app, 'PUT', '/slots', { agentSlots: 4, signedBy: kasia.id });
    expect(response.statusCode).toBe(200);
    expect(StatusResponse.parse(response.json()).agentSlots).toBe(4);
    const [change] = await listSettingsChanges(db, { area: 'budget', entity: 'agent_slots' });
    expect(change).toMatchObject({ before: { agentSlots: 2 }, after: { agentSlots: 4 } });

    const tooMany = await send(app, 'PUT', '/slots', { agentSlots: 21, signedBy: kasia.id });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe('invalid_request');
  });

  test('state budget_reached once today spend reaches the budget', async () => {
    await writeAppSettings(db, { ...DEFAULT_APP_SETTINGS, dailyBudgetUsd: 1 });
    const app = await api();
    const before = await status(app);
    expect(before).toMatchObject({ state: 'running', dailyBudgetUsd: 1, queuedCount: 0 });

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
      costUsd: 1.25,
      costSource: 'reported',
      status: 'completed',
    });

    expect(await status(app)).toMatchObject({ state: 'budget_reached', todaySpendUsd: 1.25 });
  });
});
