import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, test } from 'vitest';
import { InvalidBlobKeyError, type BlobStore } from '../blob-store/index.ts';

const INVALID_KEYS = [
  '',
  '../escape.json',
  'github-events/../../escape.json',
  '..',
  '.',
  '/absolute.json',
  'double//slash.json',
  'trailing/',
  '.hidden',
  'back\\slash.json',
  'nul\0byte',
  'spa ce.json',
];

/**
 * The behaviour every `BlobStore` adapter shares. Call it inside an adapter's test file with a
 * factory; each test uses fresh keys under `contract/<uuid>/`, so a shared bucket is fine.
 */
export function blobStoreContract(make: () => BlobStore | Promise<BlobStore>): void {
  describe('BlobStore contract', () => {
    let store: BlobStore;
    let prefix: string;

    beforeEach(async () => {
      store = await make();
      prefix = `contract/${randomUUID()}`;
    });

    test('round-trips bytes and the content type', async () => {
      const key = `${prefix}/github-events/${randomUUID()}.json`;
      const body = new Uint8Array(256).map((_, index) => index);

      await store.put(key, body, { contentType: 'application/json' });

      expect(await store.get(key)).toEqual({ body, contentType: 'application/json' });
    });

    test('stores string bodies as UTF-8', async () => {
      const key = `${prefix}/sessions/42/transcript.jsonl`;
      const text = '{"turn":1,"text":"zażółć 🚀"}\n';

      await store.put(key, text, { contentType: 'application/x-ndjson' });

      const blob = await store.get(key);
      expect(new TextDecoder().decode(blob?.body)).toBe(text);
    });

    test('a second put overwrites the blob', async () => {
      const key = `${prefix}/overwrite.json`;

      await store.put(key, '{"v":1}', { contentType: 'application/json' });
      await store.put(key, 'second', { contentType: 'text/plain' });

      const blob = await store.get(key);
      expect(new TextDecoder().decode(blob?.body)).toBe('second');
      expect(blob?.contentType).toBe('text/plain');
    });

    test('a missing key returns null and does not exist', async () => {
      const key = `${prefix}/missing.json`;

      expect(await store.get(key)).toBeNull();
      expect(await store.exists(key)).toBe(false);
    });

    test('exists follows put and delete; deleting twice is fine', async () => {
      const key = `${prefix}/sessions/7/transcript.jsonl`;

      await store.put(key, 'x', { contentType: 'text/plain' });
      expect(await store.exists(key)).toBe(true);

      await store.delete(key);
      await store.delete(key);
      expect(await store.exists(key)).toBe(false);
      expect(await store.get(key)).toBeNull();
    });

    test('keys under the same prefix stay separate', async () => {
      await store.put(`${prefix}/sessions/1/transcript.jsonl`, 'one', {
        contentType: 'text/plain',
      });
      await store.put(`${prefix}/sessions/2/transcript.jsonl`, 'two', {
        contentType: 'text/plain',
      });

      const one = await store.get(`${prefix}/sessions/1/transcript.jsonl`);
      expect(new TextDecoder().decode(one?.body)).toBe('one');
    });

    test.each(INVALID_KEYS)('rejects the key %j in every operation', async (key) => {
      const body = 'should never be written';

      await expect(store.put(key, body, { contentType: 'text/plain' })).rejects.toBeInstanceOf(
        InvalidBlobKeyError,
      );
      await expect(store.get(key)).rejects.toBeInstanceOf(InvalidBlobKeyError);
      await expect(store.exists(key)).rejects.toBeInstanceOf(InvalidBlobKeyError);
      await expect(store.delete(key)).rejects.toBeInstanceOf(InvalidBlobKeyError);
    });
  });
}
