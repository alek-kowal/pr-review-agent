import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { blobStoreContract } from '../testing/index.ts';
import { LocalBlobStore, localBlobStoreFromEnv, resolveBlobDir } from './local-blob-store.ts';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pra-blobs-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('LocalBlobStore', () => {
  blobStoreContract(() => new LocalBlobStore(path.join(root, 'contract')));

  test('keeps files under its directory', async () => {
    const store = new LocalBlobStore(path.join(root, 'layout'));

    await store.put('github-events/abc.json', '{}', { contentType: 'application/json' });

    expect(existsSync(path.join(root, 'layout/objects/github-events/abc.json'))).toBe(true);
    expect(await readdir(path.join(root, 'layout/tmp'))).toEqual([]);
  });

  test('a ../ key writes nothing outside the directory', async () => {
    const store = new LocalBlobStore(path.join(root, 'jail', 'blobs'));

    await expect(store.put('../outside.json', '{}', { contentType: 'text/plain' })).rejects.toThrow(
      'Invalid blob key',
    );

    expect(existsSync(path.join(root, 'jail', 'outside.json'))).toBe(false);
    expect(existsSync(path.join(root, 'jail', 'blobs', 'outside.json'))).toBe(false);
  });
});

describe('BLOB_DIR', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../../..');

  test('defaults to .data/blobs at the repo root', () => {
    expect(localBlobStoreFromEnv({}).dir).toBe(path.join(repoRoot, '.data/blobs'));
  });

  test('relative values count from the repo root, absolute ones are kept', () => {
    expect(resolveBlobDir('tmp/blobs')).toBe(path.join(repoRoot, 'tmp/blobs'));
    expect(resolveBlobDir('/var/pra/blobs')).toBe('/var/pra/blobs');
  });
});
