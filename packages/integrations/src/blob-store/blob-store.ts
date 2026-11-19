/** Raw payloads and transcripts: GitHub event bodies, agent session logs (NFR Complete logs). */
export interface BlobStore {
  /** Writes `body` under `key`, replacing any blob already there. */
  put(key: string, body: BlobBody, options: PutBlobOptions): Promise<void>;
  /** The blob under `key`, or `null` when there is none. */
  get(key: string): Promise<StoredBlob | null>;
  exists(key: string): Promise<boolean>;
  /** Removes the blob; a missing key is not an error. */
  delete(key: string): Promise<void>;
}

/** Strings are stored as UTF-8. */
export type BlobBody = string | Uint8Array;
export type PutBlobOptions = { contentType: string };
export type StoredBlob = { body: Uint8Array; contentType: string };

/** Content type a store reports when it has none for a blob. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Keys are `/`-separated segments of letters, digits, `.`, `_` and `-`, not starting with a dot,
 * e.g. `github-events/<deliveryId>.json` or `sessions/<sessionId>/transcript.jsonl`. That rules
 * out `..`, absolute paths, empty segments and backslashes in every adapter.
 */
const KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const MAX_KEY_LENGTH = 1024;

export class InvalidBlobKeyError extends Error {
  readonly code = 'invalid_blob_key';
  readonly key: string;

  constructor(key: string) {
    super(`Invalid blob key: ${JSON.stringify(key)}`);
    this.key = key;
    this.name = 'InvalidBlobKeyError';
  }
}

/** Throws `InvalidBlobKeyError` unless `key` follows the key rules above. */
export function assertBlobKey(key: string): void {
  const valid =
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= MAX_KEY_LENGTH &&
    key.split('/').every((segment) => KEY_SEGMENT.test(segment));
  if (!valid) throw new InvalidBlobKeyError(key);
}

export function toBytes(body: BlobBody): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body;
}
