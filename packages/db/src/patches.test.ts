import { HAND } from '@pra/core';
import { afterAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  editPatchFile,
  getPatch,
  insertRun,
  latestPatch,
  loadPrStateInput,
  revertPatchFile,
  storePatchCheck,
  storePatchRevision,
  type StorePatchInput,
} from './index.ts';
import { aRun, seedPullRequest, testDatabaseUrl } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

async function seedPatch(overrides: Partial<StorePatchInput> = {}) {
  const { pullRequest } = await seedPullRequest(db);
  const run = await insertRun(
    db,
    aRun(pullRequest.id, { kind: 'implementer', status: 'completed', levelNumber: 4 }),
  );
  const stored = await storePatchRevision(db, {
    pullRequestId: pullRequest.id,
    runId: run.id,
    baseSha: pullRequest.headSha,
    findingIds: [1, 2],
    fixedFindingIds: [1, 2],
    reproductions: { '1': 'pass', '2': 'pass' },
    summary: 'Fixed both',
    reviseNote: null,
    startedBy: HAND,
    files: [
      { path: 'src/a.ts', baseBlobKey: 'base/a', blobKey: 'after/a' },
      { path: 'src/b.ts', baseBlobKey: 'base/b', blobKey: 'after/b' },
    ],
    ...overrides,
  });
  return { pullRequest, run, ...stored };
}

describe('patches', () => {
  test('stores revision 1 once per run, with its files', async () => {
    const { patch, created, run, pullRequest } = await seedPatch();
    expect(created).toBe(true);
    expect(patch).toMatchObject({ revision: 1, status: 'ready', startedBy: 'hand' });

    const again = await storePatchRevision(db, {
      pullRequestId: pullRequest.id,
      runId: run.id,
      baseSha: 'x',
      findingIds: [],
      fixedFindingIds: [],
      reproductions: {},
      summary: '',
      reviseNote: null,
      startedBy: HAND,
      files: [],
    });
    expect(again).toEqual({ created: false, patch });
    expect((await getPatch(db, patch.id))?.files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  test('editing a file stores a new blob key and resets the reproductions', async () => {
    const { patch } = await seedPatch();
    const edited = await editPatchFile(db, {
      patchId: patch.id,
      revision: 1,
      path: 'src/a.ts',
      expectedBlobKey: 'after/a',
      blobKey: 'edit/a',
    });
    expect(edited).toMatchObject({ ok: true, file: { blobKey: 'edit/a', status: 'edited' } });
    expect(edited.ok && edited.patch).toMatchObject({
      checking: true,
      reproductions: { '1': 'not_run', '2': 'not_run' },
    });
  });

  test('an edit from a stale blob key or revision is refused', async () => {
    const { patch } = await seedPatch();
    const target = { patchId: patch.id, path: 'src/a.ts', blobKey: 'edit/a' };
    expect(await editPatchFile(db, { ...target, revision: 1, expectedBlobKey: 'old' })).toEqual({
      ok: false,
      reason: 'stale',
      revision: 1,
    });
    expect(await editPatchFile(db, { ...target, revision: 2, expectedBlobKey: 'after/a' })).toEqual(
      { ok: false, reason: 'stale', revision: 1 },
    );
  });

  test('revert marks the file reverted and points it at the base content', async () => {
    const { patch } = await seedPatch();
    const reverted = await revertPatchFile(db, {
      patchId: patch.id,
      revision: 1,
      path: 'src/b.ts',
      expectedBlobKey: 'after/b',
    });
    expect(reverted).toMatchObject({ ok: true, file: { blobKey: 'base/b', status: 'reverted' } });
  });

  test('a new revision supersedes the old one', async () => {
    const first = await seedPatch();
    const run2 = await insertRun(
      db,
      aRun(first.pullRequest.id, { kind: 'implementer', status: 'completed', levelNumber: 4 }),
    );
    const second = await storePatchRevision(db, {
      pullRequestId: first.pullRequest.id,
      runId: run2.id,
      baseSha: first.pullRequest.headSha,
      findingIds: [1, 2],
      fixedFindingIds: [1],
      reproductions: { '1': 'pass' },
      summary: 'Revised',
      reviseNote: 'Keep the old name',
      startedBy: HAND,
      files: [{ path: 'src/a.ts', baseBlobKey: 'base/a', blobKey: 'rev2/a' }],
    });
    expect(second.patch).toMatchObject({ revision: 2, status: 'ready' });
    expect((await getPatch(db, first.patch.id))?.status).toBe('superseded');
    expect((await latestPatch(db, first.pullRequest.id))?.id).toBe(second.patch.id);
  });

  test('a patch check stores results unless the patch changed after it read it', async () => {
    const { patch } = await seedPatch();
    const edited = await editPatchFile(db, {
      patchId: patch.id,
      revision: 1,
      path: 'src/a.ts',
      expectedBlobKey: 'after/a',
      blobKey: 'edit/a',
    });
    if (!edited.ok) throw new Error('edit refused');
    const seen = edited.patch.updatedAt;
    expect(await storePatchCheck(db, patch.id, new Date(seen.getTime() - 1), {})).toBe(false);
    expect(await storePatchCheck(db, patch.id, seen, { '1': 'pass', '2': 'fail' })).toBe(true);
    expect(await getPatch(db, patch.id)).toMatchObject({
      checking: false,
      checkVersion: 1,
      reproductions: { '1': 'pass', '2': 'fail' },
    });
  });

  test('the state loader reads a ready patch on the reviewed commit', async () => {
    const { pullRequest } = await seedPullRequest(db, { repository: { defaultLevel: 4 } });
    await insertRun(
      db,
      aRun(pullRequest.id, { status: 'completed', levelNumber: 4, headSha: pullRequest.headSha }),
    );
    const run = await insertRun(
      db,
      aRun(pullRequest.id, { kind: 'implementer', status: 'completed', levelNumber: 4 }),
    );
    await storePatchRevision(db, {
      pullRequestId: pullRequest.id,
      runId: run.id,
      baseSha: pullRequest.headSha,
      findingIds: [1, 2],
      fixedFindingIds: [1, 2],
      reproductions: { '1': 'pass', '2': 'pass' },
      summary: '',
      reviseNote: null,
      startedBy: HAND,
      files: [],
    });
    const load = await loadPrStateInput(db, pullRequest.id);
    expect(load?.input.patch).toEqual({
      status: 'ready',
      fixed: 2,
      total: 2,
      reproductionsPass: true,
      waiting: null,
    });
  });
});
