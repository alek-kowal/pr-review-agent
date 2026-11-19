import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBlobKey,
  DEFAULT_CONTENT_TYPE,
  InvalidBlobKeyError,
  toBytes,
  type BlobBody,
  type BlobStore,
  type PutBlobOptions,
  type StoredBlob,
} from './blob-store.ts';

export const DEFAULT_BLOB_DIR = '.data/blobs';

/** The repository root, so api and worker resolve the same directory whatever their cwd. */
const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** `BLOB_DIR` as an absolute path: relative values (and the default) count from the repo root. */
export function resolveBlobDir(blobDir: string | undefined): string {
  return path.resolve(WORKSPACE_ROOT, blobDir || DEFAULT_BLOB_DIR);
}

/**
 * Keeps blobs as files under one directory: `objects/<key>` holds the bytes and
 * `meta/<key>.json` the content type. Writes go to `tmp/` first and are renamed into place, so a
 * reader never sees half a blob. Local development and tests only; hosted runs use S3 (F-04).
 */
export class LocalBlobStore implements BlobStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  async put(key: string, body: BlobBody, { contentType }: PutBlobOptions): Promise<void> {
    const { object, meta } = this.#paths(key);
    await this.#writeAtomic(meta, JSON.stringify({ contentType }));
    await this.#writeAtomic(object, toBytes(body));
  }

  async get(key: string): Promise<StoredBlob | null> {
    const { object, meta } = this.#paths(key);
    const body = await readIfExists(object);
    if (body === null) return null;
    const metadata = await readIfExists(meta);
    const contentType =
      metadata === null
        ? DEFAULT_CONTENT_TYPE
        : ((JSON.parse(metadata.toString('utf8')) as { contentType?: string }).contentType ??
          DEFAULT_CONTENT_TYPE);
    return { body: new Uint8Array(body), contentType };
  }

  async exists(key: string): Promise<boolean> {
    const { object } = this.#paths(key);
    try {
      return (await stat(object)).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { object, meta } = this.#paths(key);
    await rm(object, { force: true });
    await rm(meta, { force: true });
  }

  #paths(key: string): { object: string; meta: string } {
    assertBlobKey(key);
    const object = path.join(this.dir, 'objects', ...key.split('/'));
    const meta = `${path.join(this.dir, 'meta', ...key.split('/'))}.json`;
    // The key rules already forbid `..`; this keeps any future rule change from escaping `dir`.
    for (const file of [object, meta]) {
      if (!file.startsWith(this.dir + path.sep)) throw new InvalidBlobKeyError(key);
    }
    return { object, meta };
  }

  async #writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    const tmpDir = path.join(this.dir, 'tmp');
    const tmp = path.join(tmpDir, randomUUID());
    await mkdir(tmpDir, { recursive: true });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, data);
    try {
      await rename(tmp, file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }
}

/** The local store on `BLOB_DIR` (default `.data/blobs` at the repo root). */
export function localBlobStoreFromEnv(env: NodeJS.ProcessEnv = process.env): LocalBlobStore {
  return new LocalBlobStore(resolveBlobDir(env.BLOB_DIR));
}

async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
