// S-21-T3: Settings → Models and Review levels, signed through `applySignedSettingsChange`.
import { DEFAULT_MODELS } from '@pra/core';
import { closeDb, createDb, listSettingsChanges, type Db, type TeamMember } from '@pra/db';
import { createTestDatabase, seedTeamMember, type TestDatabase } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build, SAME_ORIGIN } from '../helper.ts';

// Its own database: model and level settings are global.
let database: TestDatabase;
let db: Db;
let app: FastifyInstance;
let signer: TeamMember;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 3 });
  signer = await seedTeamMember(db);
}, 30_000);

beforeEach(async () => {
  app = await build({ db });
});

afterAll(async () => {
  await closeDb(db);
  await database.drop();
});

const put = (url: string, payload: object) =>
  app.inject({ method: 'PUT', url, headers: SAME_ORIGIN, payload });
const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();

describe('models and levels API (S-21-T3)', () => {
  test('GET models lists every role with the defaults; an invalid model returns 400 naming the role', async () => {
    expect(await get('/api/settings/models')).toEqual({
      models: DEFAULT_MODELS,
      defaults: DEFAULT_MODELS,
      overrides: [],
      openRouter: {
        roles: ['judge'],
        suggested: ['openrouter/typesafe/jev-router'],
        configured: false,
      },
    });

    const response = await put('/api/settings/models', {
      models: { ...DEFAULT_MODELS, verifier: '--model=x' },
      signedBy: signer.id,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual({
      code: 'invalid_request',
      params: {
        part: 'body',
        issues: [{ path: '/models/verifier', code: 'invalid_model_name' }],
      },
    });
    expect(await listSettingsChanges(db, { area: 'models' })).toEqual([]);
  });

  test('a signed models PUT writes one settings change with before and after', async () => {
    const unsigned = await put('/api/settings/models', {
      models: { ...DEFAULT_MODELS, verifier: 'claude-haiku-5-5' },
    });
    expect(unsigned.statusCode).toBe(400);
    expect(unsigned.json().error.code).toBe('signature_required');

    const response = await put('/api/settings/models', {
      models: { ...DEFAULT_MODELS, verifier: 'claude-haiku-5-5' },
      before: DEFAULT_MODELS,
      signedBy: signer.id,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().models.verifier).toBe('claude-haiku-5-5');
    const changes = await listSettingsChanges(db, { area: 'models' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entity: 'roles',
      actor: 'member',
      signerId: signer.id,
      before: { verifier: 'claude-sonnet-5-5' },
      after: { verifier: 'claude-haiku-5-5' },
    });

    const stale = await put('/api/settings/models', {
      models: DEFAULT_MODELS,
      before: DEFAULT_MODELS,
      signedBy: signer.id,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('settings_stale');
  });

  test('a level override is inherited upward; inherit removes the own value', async () => {
    const url = '/api/settings/levels/3';
    const own = await put(url, {
      values: { stageTimeoutMinutes: 12, maxFindings: 'inherit', models: { judge: 'j-1' } },
      signedBy: signer.id,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().level.own).toEqual({ stageTimeoutMinutes: 12, models: { judge: 'j-1' } });

    const level4 = (await get('/api/settings/levels/4')).level;
    expect(level4.own).toEqual({});
    expect(level4.settings.stageTimeoutMinutes).toBe(12);
    expect(level4.origins.stageTimeoutMinutes).toEqual({ level: 3, source: 'override' });
    expect(level4.models).toContainEqual({
      role: 'judge',
      model: 'j-1',
      source: 'level',
      level: 3,
    });
    expect((await get('/api/settings/models')).overrides).toEqual([
      { level: 3, role: 'judge', model: 'j-1' },
    ]);

    const inherited = await put(url, {
      values: { stageTimeoutMinutes: 'inherit', models: { judge: 'j-1' } },
      before: { stageTimeoutMinutes: 12, models: { judge: 'j-1' } },
      signedBy: signer.id,
    });
    expect(inherited.statusCode).toBe(200);
    expect(inherited.json().level.own).toEqual({ models: { judge: 'j-1' } });
    expect(inherited.json().level.settings.stageTimeoutMinutes).toBe(30);

    const changes = await listSettingsChanges(db, { area: 'levels', entity: '3' });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      before: { stageTimeoutMinutes: 12, models: { judge: 'j-1' } },
      after: { models: { judge: 'j-1' } },
    });
  });

  test('validation errors name the field; patches are set only from level 5', async () => {
    const tooMany = await put('/api/settings/levels/2', {
      values: { maxFindings: 8 },
      signedBy: signer.id,
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.params.issues[0].path).toBe('/values/maxFindings');

    const badModel = await put('/api/settings/levels/6', {
      values: { models: { reviewer: 'claude opus' } },
      signedBy: signer.id,
    });
    expect(badModel.statusCode).toBe(400);
    expect(badModel.json().error.params.issues[0].path).toBe('/values/models/reviewer');

    const early = await put('/api/settings/levels/4', {
      values: { autofixMaxPatches: 1 },
      signedBy: signer.id,
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().error.params.issues).toEqual([
      { path: '/values/autofixMaxPatches', code: 'not_at_this_level' },
    ]);

    const level5 = await put('/api/settings/levels/5', {
      values: { autofixMaxPatches: 1 },
      signedBy: signer.id,
    });
    expect(level5.statusCode).toBe(200);
    expect(level5.json().level.settings.autofixMaxPatches).toBe(1);
    expect((await get('/api/settings/levels/6')).level.settings.autofixMaxPatches).toBe(1);
  });

  test('the default level PUT is signed and writes one settings change', async () => {
    expect((await get('/api/settings/levels')).defaultLevel).toBe(1);
    const response = await put('/api/settings/default-level', {
      defaultLevel: 2,
      before: { defaultLevel: 1 },
      signedBy: signer.id,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ defaultLevel: 2 });
    const levels = await get('/api/settings/levels');
    expect(levels.defaultLevel).toBe(2);
    expect(
      levels.levels.map((l: { number: number; adds: string[] }) => [l.number, l.adds]),
    ).toEqual([
      [1, ['review']],
      [2, ['checks', 'task', 'change_type']],
      [3, ['verify']],
      [4, ['implement']],
      [5, ['autofix']],
      [6, ['learning']],
    ]);
    expect(await listSettingsChanges(db, { area: 'levels', entity: 'default' })).toEqual([
      expect.objectContaining({ before: { defaultLevel: 1 }, after: { defaultLevel: 2 } }),
    ]);
  });
});

describe('an OpenRouter judge in Settings → Models (P-26)', () => {
  const JEV = 'openrouter/typesafe/jev-router';

  test('the judge may pick an OpenRouter model, signed; no other role may', async () => {
    app = await build({ db, openRouterConfigured: true });
    const before = (await get('/api/settings/models')).models;
    expect((await get('/api/settings/models')).openRouter.configured).toBe(true);

    const reviewer = await put('/api/settings/models', {
      models: { ...before, reviewer: JEV },
      signedBy: signer.id,
    });
    expect(reviewer.statusCode).toBe(400);
    expect(reviewer.json().error.params.issues).toEqual([
      { path: '/models/reviewer', code: 'invalid_model_name' },
    ]);

    const judge = await put('/api/settings/models', {
      models: { ...before, judge: JEV },
      before,
      signedBy: signer.id,
    });
    expect(judge.statusCode).toBe(200);
    expect(judge.json().models.judge).toBe(JEV);
    const changes = await listSettingsChanges(db, { area: 'models' });
    const change = changes.find((c) => (c.after as { judge?: string } | null)?.judge === JEV);
    expect(change).toMatchObject({
      signerId: signer.id,
      before: { judge: 'claude-haiku-5-5' },
      after: { judge: JEV },
    });

    // Put it back: the settings are global to this file's database.
    const back = await put('/api/settings/models', {
      models: before,
      before: { ...before, judge: JEV },
      signedBy: signer.id,
    });
    expect(back.statusCode).toBe(200);
  });
});
