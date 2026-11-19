// S-21-T9: Settings → Alerts, signed through `applySignedSettingsChange` (area `alerts`). Own
// database: the alert config is one global row.
import { DEFAULT_ALERT_CONFIG } from '@pra/core';
import {
  closeDb,
  createDb,
  getAlertConfig,
  listSettingsChanges,
  type Db,
  type TeamMember,
} from '@pra/db';
import { createTestDatabase, seedTeamMember, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AlertSettingsResponse } from '../../src/routes/api/settings/alerts/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

let database: TestDatabase;
let db: Db;
let signer: TeamMember;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 3 });
  signer = await seedTeamMember(db);
}, 30_000);

afterAll(async () => {
  await closeDb(db);
  await database.drop();
});

test('alert settings: read, unsigned 400, signed write with before and after, invalid values', async () => {
  const app = await build({ db });
  const put = (payload: object) =>
    app.inject({ method: 'PUT', url: '/api/settings/alerts', headers: SAME_ORIGIN, payload });

  const read = await app.inject({ method: 'GET', url: '/api/settings/alerts' });
  expect(read.statusCode).toBe(200);
  expect(AlertSettingsResponse.parse(read.json()).config).toEqual(DEFAULT_ALERT_CONFIG);

  const after = {
    ...DEFAULT_ALERT_CONFIG,
    costMaxUsd: 7.5,
    budgetPercent: 90,
    roundsOn: false,
    generalTaskId: 'WB-700',
  };

  // Unsigned: 400, nothing written.
  const unsigned = await put({ config: after, before: DEFAULT_ALERT_CONFIG });
  expect(unsigned.statusCode).toBe(400);
  expect(unsigned.json().error.code).toBe('signature_required');
  expect(await listSettingsChanges(db, { area: 'alerts' })).toEqual([]);

  // Signed: one settings change with before and after.
  const saved = await put({ config: after, before: DEFAULT_ALERT_CONFIG, signedBy: signer.id });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toEqual({ config: after });
  expect(await getAlertConfig(db)).toEqual(after);
  const changes = await listSettingsChanges(db, { area: 'alerts' });
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    entity: 'config',
    actor: 'member',
    signerId: signer.id,
    before: { costMaxUsd: 5, budgetPercent: 80, roundsOn: true, generalTaskId: null },
    after: { costMaxUsd: 7.5, budgetPercent: 90, roundsOn: false, generalTaskId: 'WB-700' },
  });

  // What the signer saw is no longer stored: 409.
  const stale = await put({ config: after, before: DEFAULT_ALERT_CONFIG, signedBy: signer.id });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe('settings_stale');

  // A cost of 0 or less, a budget percent not offered, or no general task: 400.
  for (const config of [
    { ...after, costMaxUsd: 0 },
    { ...after, costMaxUsd: -1 },
    { ...after, budgetPercent: 75 },
    { ...after, generalTaskId: '' },
    { ...after, generalTaskId: null },
  ]) {
    const response = await put({ config, signedBy: signer.id });
    expect(response.statusCode, JSON.stringify(config)).toBe(400);
  }
  expect(await listSettingsChanges(db, { area: 'alerts' })).toHaveLength(1);
});
