// S-21-T6: GET /api/audit over `settings_changes`.
import { DEFAULT_MODELS } from '@pra/core';
import { closeDb, createDb, insertSettingsChange, type Db, type TeamMember } from '@pra/db';
import { createTestDatabase, seedTeamMember, type TestDatabase } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build } from '../helper.ts';

// Its own database: the audit log is global, and the test counts its rows.
let database: TestDatabase;
let db: Db;
let app: FastifyInstance;
let kasia: TeamMember;
let tomek: TeamMember;

type Entry = {
  id: number;
  at: string;
  area: string;
  entity: string;
  actor: string;
  signer: { id: string; name: string } | null;
  before: unknown;
  after: unknown;
};
type Page = { entries: Entry[]; nextCursor: string | null; areas: string[]; signers: unknown[] };

const T0 = new Date('2026-11-10T10:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 3 });
  kasia = await seedTeamMember(db, { name: 'Kasia' });
  tomek = await seedTeamMember(db, { name: 'Tomek' });
  // A signed model change (as `PUT /api/settings/models` logs it), the bot's own change, an
  // unsigned change and another signer's. The newest is the model change (written last, now).
  await insertSettingsChange(db, {
    area: 'budget',
    entity: 'monthly',
    actor: 'bot',
    before: { limitUsd: 100 },
    after: { limitUsd: 120 },
    note: 'raised by the bot',
    at: at(1),
  });
  await insertSettingsChange(db, {
    area: 'team',
    entity: tomek.id,
    actor: 'hand',
    before: null,
    after: { name: 'Tomek' },
    at: at(2),
  });
  await insertSettingsChange(db, {
    area: 'repositories',
    entity: 'acme/one',
    actor: 'member',
    signerId: tomek.id,
    before: { largePrLines: 400 },
    after: { largePrLines: 600 },
    at: at(3),
  });
  await insertSettingsChange(db, {
    area: 'models',
    entity: 'roles',
    actor: 'member',
    signerId: kasia.id,
    before: DEFAULT_MODELS,
    after: { ...DEFAULT_MODELS, verifier: 'claude-sonnet-5-6' },
  });
}, 30_000);

beforeEach(async () => {
  app = await build({ db });
});

afterAll(async () => {
  await closeDb(db);
  await database.drop();
});

const get = async (query = ''): Promise<Page> => {
  const response = await app.inject({ method: 'GET', url: `/api/audit${query}` });
  expect(response.statusCode).toBe(200);
  return response.json();
};

describe('GET /api/audit (S-21-T6)', () => {
  test('searching "verifier" finds the model change with before, after and the signer', async () => {
    const page = await get('?q=verifier');
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      area: 'models',
      entity: 'roles',
      actor: 'member',
      signer: { id: kasia.id, name: 'Kasia' },
      before: DEFAULT_MODELS,
      after: { ...DEFAULT_MODELS, verifier: 'claude-sonnet-5-6' },
    });
    // The search is case-insensitive and also reads the signer's name and the area.
    expect((await get('?q=VERIFIER')).entries).toHaveLength(1);
    expect((await get('?q=tomek')).entries.map((e) => e.area).sort()).toEqual([
      'repositories',
      'team',
    ]);
    expect((await get('?q=budg')).entries.map((e) => e.area)).toEqual(['budget']);
    // LIKE wildcards match themselves.
    expect((await get('?q=%25')).entries).toHaveLength(0);
  });

  test('every change is listed newest first, bot rows included, with the filter facets', async () => {
    const page = await get();
    expect(page.entries.map((e) => e.area)).toEqual(['models', 'repositories', 'team', 'budget']);
    expect(page.entries.find((e) => e.area === 'budget')).toMatchObject({
      actor: 'bot',
      signer: null,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.areas).toEqual(['budget', 'models', 'repositories', 'team']);
    expect(page.signers).toEqual([
      { id: kasia.id, name: 'Kasia' },
      { id: tomek.id, name: 'Tomek' },
    ]);
  });

  test('the area, actor and date filters work', async () => {
    expect((await get('?area=models')).entries.map((e) => e.entity)).toEqual(['roles']);
    expect((await get('?actor=bot')).entries.map((e) => e.area)).toEqual(['budget']);
    expect((await get('?actor=hand')).entries.map((e) => e.area)).toEqual(['team']);
    expect((await get(`?actor=${tomek.id}`)).entries.map((e) => e.area)).toEqual(['repositories']);
    const from = encodeURIComponent(at(1).toISOString());
    const to = encodeURIComponent(at(3).toISOString());
    expect((await get(`?from=${from}&to=${to}`)).entries.map((e) => e.area)).toEqual([
      'team',
      'budget',
    ]);
    const bad = await app.inject({ method: 'GET', url: '/api/audit?actor=someone' });
    expect(bad.statusCode).toBe(400);
  });

  test('pagination is stable while new changes are written', async () => {
    const all = (await get()).entries.map((e) => e.id);
    const first = await get('?limit=2');
    expect(first.entries.map((e) => e.id)).toEqual(all.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();

    // A change written between pages lands on top, not on the next page.
    await insertSettingsChange(db, {
      area: 'alerts',
      entity: 'failed-run',
      actor: 'bot',
      before: null,
      after: { on: true },
    });
    const second = await get(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.entries.map((e) => e.id)).toEqual(all.slice(2, 4));
    expect(second.nextCursor).toBeNull();
    expect((await get('?limit=2')).entries[0]?.area).toBe('alerts');
  });
});
