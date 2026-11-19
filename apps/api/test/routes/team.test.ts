import { closeDb, createDb, listSettingsChanges } from '@pra/db';
import { createTestDatabase, seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { TeamResponse } from '../../src/routes/api/team/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  // `build` closes the app when the test finishes, so each test gets its own.
  app = await build({ db });
});
let signer: { id: string; name: string };
beforeAll(async () => {
  signer = await seedTeamMember(db, { name: 'Tomek' });
});

const login = () => `kasia-${uniqueId()}`;

async function send(method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, headers: SAME_ORIGIN, payload });
}

describe('Team api', () => {
  test('add, edit and remove each write a log row with before and after', async () => {
    const githubLogin = login();
    const added = await send('POST', '/api/team', {
      name: 'Kasia',
      githubLogin: `@${githubLogin}`,
      clickupUserId: '',
      signedBy: signer.id,
    });
    expect(added.statusCode).toBe(201);
    const { member } = added.json<{ member: { id: string } }>();
    expect(member).toEqual({ id: member.id, name: 'Kasia', githubLogin, clickupUserId: null });

    const edited = await send('PATCH', `/api/team/${member.id}`, {
      clickupUserId: '8812',
      signedBy: signer.id,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toEqual({
      member: { id: member.id, name: 'Kasia', githubLogin, clickupUserId: '8812' },
    });

    const removed = await send('DELETE', `/api/team/${member.id}`, { signedBy: signer.id });
    expect(removed.statusCode).toBe(204);

    const kasia = { name: 'Kasia', githubLogin, clickupUserId: null };
    const log = await listSettingsChanges(db, { area: 'team', entity: member.id });
    expect(
      log.map(({ actor, signerId, before, after }) => ({ actor, signerId, before, after })),
    ).toEqual([
      {
        actor: 'member',
        signerId: signer.id,
        before: { ...kasia, clickupUserId: '8812' },
        after: null,
      },
      {
        actor: 'member',
        signerId: signer.id,
        before: kasia,
        after: { ...kasia, clickupUserId: '8812' },
      },
      { actor: 'member', signerId: signer.id, before: null, after: kasia },
    ]);

    const team = TeamResponse.parse((await app.inject('/api/team')).json());
    expect(team.members.map((m) => m.id)).toContain(signer.id);
    expect(team.members.map((m) => m.id)).not.toContain(member.id);
  });

  test('no signature gives 400 signature_required', async () => {
    const member = await seedTeamMember(db);
    const responses = [
      await send('POST', '/api/team', { name: 'Ola', githubLogin: login() }),
      await send('PATCH', `/api/team/${member.id}`, { name: 'Ola' }),
      await send('DELETE', `/api/team/${member.id}`, {}),
      await send('DELETE', `/api/team/${member.id}`),
    ];

    for (const response of responses) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: 'signature_required', params: {} } });
    }
    expect(await listSettingsChanges(db, { area: 'team', entity: member.id })).toEqual([]);
  });

  test('a signer not in Team gives 400 signer_unknown', async () => {
    const left = await seedTeamMember(db);
    await send('DELETE', `/api/team/${left.id}`, { signedBy: signer.id });

    for (const signedBy of [left.id, 'nobody']) {
      const response = await send('POST', '/api/team', {
        name: 'Ola',
        githubLogin: login(),
        signedBy,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: 'signer_unknown', params: { signer: signedBy } },
      });
    }
  });

  test('a duplicate active GitHub login gives 409 github_login_taken', async () => {
    const taken = await seedTeamMember(db, { githubLogin: login() });
    const other = await seedTeamMember(db);

    const add = await send('POST', '/api/team', {
      name: 'Kasia 2',
      githubLogin: taken.githubLogin.toUpperCase(),
      signedBy: signer.id,
    });
    const edit = await send('PATCH', `/api/team/${other.id}`, {
      githubLogin: taken.githubLogin,
      signedBy: signer.id,
    });

    for (const response of [add, edit]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'github_login_taken' } });
    }
    expect(await listSettingsChanges(db, { area: 'team', entity: other.id })).toEqual([]);
  });

  test('an edit from a stale before gives 409 settings_stale', async () => {
    const member = await seedTeamMember(db, { name: 'Ewa' });
    const before = { name: 'Ewa', githubLogin: member.githubLogin, clickupUserId: null };
    await send('PATCH', `/api/team/${member.id}`, { name: 'Ewa K', signedBy: signer.id });

    const response = await send('PATCH', `/api/team/${member.id}`, {
      name: 'Ewa N',
      before,
      signedBy: signer.id,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'settings_stale', params: { current: { ...before, name: 'Ewa K' } } },
    });
  });

  test('an unknown or removed member gives 404, a bad login 400', async () => {
    const missing = await send('PATCH', '/api/team/2b1d0c51-7f0e-4c43-9a4f-000000000000', {
      name: 'X',
      signedBy: signer.id,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'team_member_not_found' } });

    const bad = await send('POST', '/api/team', {
      name: 'X',
      githubLogin: 'not a login',
      signedBy: signer.id,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('Team api on an empty team', () => {
  test('the first member signs as themselves, the second needs a signature', async () => {
    const database = await createTestDatabase();
    const empty = createDb(database.url, { max: 2 });
    try {
      const api = await build({ db: empty });
      const add = (body: object) =>
        api.inject({ method: 'POST', url: '/api/team', headers: SAME_ORIGIN, payload: body });

      const first = await add({ name: 'Alek', githubLogin: 'alek' });
      expect(first.statusCode).toBe(201);
      const alek = first.json<{ member: { id: string } }>().member;
      expect(await listSettingsChanges(empty, { area: 'team' })).toEqual([
        expect.objectContaining({ entity: alek.id, signerId: alek.id, before: null }),
      ]);

      const second = await add({ name: 'Kasia', githubLogin: 'kasia' });
      expect(second.statusCode).toBe(400);
      expect(second.json()).toMatchObject({ error: { code: 'signature_required' } });
      expect(
        (await add({ name: 'Kasia', githubLogin: 'kasia', signedBy: alek.id })).statusCode,
      ).toBe(201);
    } finally {
      await closeDb(empty);
      await database.drop();
    }
  });
});
