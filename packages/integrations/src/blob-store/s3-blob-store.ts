import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
  assertBlobKey,
  DEFAULT_CONTENT_TYPE,
  toBytes,
  type BlobBody,
  type BlobStore,
  type PutBlobOptions,
  type StoredBlob,
} from './blob-store.ts';

export type S3BlobStoreOptions = { bucket: string; client: S3Client };

/**
 * Keeps blobs as objects in one S3 bucket (hosted runs; MinIO locally). The key is the object key
 * and the content type is the object's `Content-Type`. Keys are checked before any request.
 */
export class S3BlobStore implements BlobStore {
  readonly bucket: string;
  readonly #client: S3Client;

  constructor({ bucket, client }: S3BlobStoreOptions) {
    this.bucket = bucket;
    this.#client = client;
  }

  async put(key: string, body: BlobBody, { contentType }: PutBlobOptions): Promise<void> {
    assertBlobKey(key);
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: toBytes(body),
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredBlob | null> {
    assertBlobKey(key);
    try {
      const object = await this.#client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = (await object.Body?.transformToByteArray()) ?? new Uint8Array();
      return {
        body: new Uint8Array(body),
        contentType: object.ContentType ?? DEFAULT_CONTENT_TYPE,
      };
    } catch (error) {
      // Only a missing key: a missing bucket (`NoSuchBucket`, also a 404) is a setup error.
      if (errorName(error) === 'NoSuchKey') return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertBlobKey(key);
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      // A HEAD response has no body, so a missing bucket is a 404 `NotFound` here too.
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** S3 deletes are idempotent: a missing key succeeds. */
  async delete(key: string): Promise<void> {
    assertBlobKey(key);
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * An S3 client from env: `S3_ENDPOINT` (set for MinIO and other S3-compatible stores, which also
 * get path-style URLs) and `AWS_REGION`. Credentials come from the AWS SDK's default chain
 * (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or the host's role).
 */
export function s3ClientConfigFromEnv(env: NodeJS.ProcessEnv): S3ClientConfig {
  const endpoint = env.S3_ENDPOINT || undefined;
  return {
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(env.AWS_REGION ? { region: env.AWS_REGION } : {}),
  };
}

function errorName(error: unknown): string | undefined {
  return ((error ?? {}) as { name?: string }).name;
}

function isNotFound(error: unknown): boolean {
  const { name, $metadata } = (error ?? {}) as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return name === 'NoSuchKey' || name === 'NotFound' || $metadata?.httpStatusCode === 404;
}
