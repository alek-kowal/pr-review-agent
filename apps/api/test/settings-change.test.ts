import { closeDb, createDb, getTeamMember, listSettingsChanges, type Executor } from '@pra/db';
import { seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import { afterAll, describe, expect, test } from 'vitest';
import {
  applySignedSettingsChange,
  NEW_ENTITY,
  sameJson,
  type SettingsStore,
} from '../src/settings/signed-change.ts';
import { teamStore, type TeamMemberSettings } from '../src/settings/team-store.ts';

const db = createDb(testDatabaseUrl(), { max: 4 });
afterAll(() => closeDb(db));

const aMember = (patch: Partial<TeamMemberSettings> = {}): TeamMemberSettings => ({
  name: 'Kasia',
  githubLogin: `kasia-${uniqueId()}`,
  clickupUserId: null,
  ...patch,
});

describe('applySignedSettingsChange', () => {
  test('a signed change writes one log row with before, after and the signer', async () => {
    const signer = await seedTeamMember(db, { name: 'Tomek' });
    const after = aMember({ clickupUserId: '42' });

    const result = await applySignedSettingsChange(db, {
      store: teamStore,
      entity: NEW_ENTITY,
      before: null,
      after,
      signer: signer.id,
      note: 'joined the team',
    });

    expect(result).toMatchObject({ ok: true, value: after });
    if (!result.ok) return;
    expect(await getTeamMember(db, result.entity)).toMatchObject(after);
    expect(await listSettingsChanges(db, { area: 'team', entity: result.entity })).toEqual([
      expect.objectContaining({
        id: result.change!.id,
        actor: 'member',
        signerId: signer.id,
        before: null,
        after,
        note: 'joined the team',
      }),
    ]);
  });

  test('an existing Team edit writes a log row', async () => {
    const signer = await seedTeamMember(db);
    const member = await seedTeamMember(db, { name: 'Piotr' });
    const before = { name: 'Piotr', githubLogin: member.githubLogin, clickupUserId: null };
    const after = { ...before, name: 'Piotr Nowak' };

    const result = await applySignedSettingsChange(db, {
      store: teamStore,
      entity: member.id,
      before,
      after,
      signer: signer.id,
    });

    expect(result).toMatchObject({ ok: true, entity: member.id, value: after });
    expect(await listSettingsChanges(db, { area: 'team', entity: member.id })).toEqual([
      expect.objectContaining({ signerId: signer.id, before, after }),
    ]);
  });

  test('an unsigned call is rejected and writes nothing', async () => {
    const store = recordingStore();

    for (const signer of [undefined, null, '']) {
      const result = await applySignedSettingsChange(db, {
        store,
        entity: 'x',
        before: null,
        after: { on: true },
        signer,
      });
      expect(result).toEqual({ ok: false, status: 400, code: 'signature_required', params: {} });
    }
    expect(store.writes).toEqual([]);
    expect(await listSettingsChanges(db, { area: store.area })).toEqual([]);
  });

  test('a signer who is not in Team is rejected', async () => {
    const store = recordingStore();
    const removed = await seedTeamMember(db);
    await applySignedSettingsChange(db, {
      store: teamStore,
      entity: removed.id,
      before: { name: removed.name, githubLogin: removed.githubLogin, clickupUserId: null },
      after: null,
      signer: (await seedTeamMember(db)).id,
    });

    for (const signer of [removed.id, 'not-a-member']) {
      expect(
        await applySignedSettingsChange(db, {
          store,
          entity: 'x',
          before: null,
          after: { on: true },
          signer,
        }),
      ).toEqual({ ok: false, status: 400, code: 'signer_unknown', params: { signer } });
    }
    expect(store.writes).toEqual([]);
  });

  test('a stale before returns 409 and writes nothing', async () => {
    const signer = await seedTeamMember(db);
    const member = await seedTeamMember(db, { name: 'Ola' });
    const seen = { name: 'Ola', githubLogin: member.githubLogin, clickupUserId: null };
    const first = await applySignedSettingsChange(db, {
      store: teamStore,
      entity: member.id,
      before: seen,
      after: { ...seen, clickupUserId: '7' },
      signer: signer.id,
    });
    expect(first.ok).toBe(true);

    const second = await applySignedSettingsChange(db, {
      store: teamStore,
      entity: member.id,
      before: seen,
      after: { ...seen, name: 'Aleksandra' },
      signer: signer.id,
    });

    expect(second).toEqual({
      ok: false,
      status: 409,
      code: 'settings_stale',
      params: { current: { ...seen, clickupUserId: '7' } },
    });
    expect(await getTeamMember(db, member.id)).toMatchObject({ name: 'Ola', clickupUserId: '7' });
    expect(await listSettingsChanges(db, { area: 'team', entity: member.id })).toHaveLength(1);
  });

  test('two concurrent saves from the same before: one applies, the other is stale', async () => {
    const signer = await seedTeamMember(db);
    const member = await seedTeamMember(db, { name: 'Ewa' });
    const seen = { name: 'Ewa', githubLogin: member.githubLogin, clickupUserId: null };

    const results = await Promise.all(
      ['Ewa K', 'Ewa N'].map((name) =>
        applySignedSettingsChange(db, {
          store: teamStore,
          entity: member.id,
          before: seen,
          after: { ...seen, name },
          signer: signer.id,
        }),
      ),
    );

    expect(results.map((r) => (r.ok ? 'ok' : r.code)).sort()).toEqual(['ok', 'settings_stale']);
    expect(await listSettingsChanges(db, { area: 'team', entity: member.id })).toHaveLength(1);
  });

  test('a failed write rolls the change back', async () => {
    const signer = await seedTeamMember(db);
    const store: SettingsStore<{ on: boolean }> = {
      area: `failing-${uniqueId()}`,
      read: async () => null,
      write: async () => {
        throw new Error('disk full');
      },
    };

    await expect(
      applySignedSettingsChange(db, {
        store,
        entity: 'x',
        before: null,
        after: { on: true },
        signer: signer.id,
      }),
    ).rejects.toThrow('disk full');
    expect(await listSettingsChanges(db, { area: store.area })).toEqual([]);
  });

  test('saving what is stored writes no log row', async () => {
    const signer = await seedTeamMember(db);
    const member = await seedTeamMember(db, { name: 'Ida' });
    const same = { name: 'Ida', githubLogin: member.githubLogin, clickupUserId: null };

    const result = await applySignedSettingsChange(db, {
      store: teamStore,
      entity: member.id,
      before: same,
      after: same,
      signer: signer.id,
    });

    expect(result).toMatchObject({ ok: true, change: null });
    expect(await listSettingsChanges(db, { area: 'team', entity: member.id })).toEqual([]);
  });

  test('signing as the created member is refused while Team has members', async () => {
    await seedTeamMember(db);

    const result = await applySignedSettingsChange(db, {
      store: teamStore,
      entity: NEW_ENTITY,
      before: null,
      after: aMember(),
      signer: undefined,
      signAsCreated: true,
    });

    expect(result).toMatchObject({ ok: false, code: 'signature_required' });
  });
});

describe('sameJson', () => {
  test('ignores key order and treats a missing field as null', () => {
    expect(sameJson({ a: 1, b: { c: null, d: [1, 2] } }, { b: { d: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson(null, undefined)).toBe(true);
    expect(sameJson(null, {})).toBe(false);
  });
});

/** A store that keeps its value in memory and records writes; its area is unique per test. */
function recordingStore(): SettingsStore<{ on: boolean }> & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    area: `test-${uniqueId()}`,
    writes,
    read: async () => null,
    write: async (_tx: Executor, entity, after) => {
      writes.push(after);
      return { entity, value: after };
    },
  };
}
