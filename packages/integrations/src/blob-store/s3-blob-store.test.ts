import type { S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  blobStoreContract,
  S3_TEST_BUCKET,
  s3TestClient,
  s3TestEndpoint,
} from '../testing/index.ts';
import { createBlobStore } from './create-blob-store.ts';
import { LocalBlobStore } from './local-blob-store.ts';
import { S3BlobStore, s3ClientConfigFromEnv } from './s3-blob-store.ts';

const endpoint = await s3TestEndpoint();
if (!endpoint) {
  console.warn(
    'S3BlobStore contract skipped: start MinIO with `docker compose --profile s3 up -d minio`.',
  );
}

describe.skipIf(!endpoint)('S3BlobStore against MinIO', () => {
  let client: S3Client;
  beforeAll(async () => {
    client = await s3TestClient(endpoint!);
  });

  blobStoreContract(() => new S3BlobStore({ bucket: S3_TEST_BUCKET, client }));

  test('a missing bucket is an error, not a missing blob', async () => {
    const store = new S3BlobStore({ bucket: 'pra-test-no-such-bucket', client });
    await expect(store.get('contract/any.json')).rejects.toMatchObject({ name: 'NoSuchBucket' });
  });
});

describe('createBlobStore', () => {
  test('picks S3 when S3_BUCKET is set', () => {
    const store = createBlobStore({ S3_BUCKET: 'pra-blobs', AWS_REGION: 'eu-central-1' });

    expect(store).toBeInstanceOf(S3BlobStore);
    expect((store as S3BlobStore).bucket).toBe('pra-blobs');
  });

  test('picks the local store on BLOB_DIR otherwise, also for an empty S3_BUCKET', () => {
    for (const env of [
      { BLOB_DIR: '/var/pra/blobs' },
      { BLOB_DIR: '/var/pra/blobs', S3_BUCKET: '' },
    ]) {
      const store = createBlobStore(env);
      expect(store).toBeInstanceOf(LocalBlobStore);
      expect((store as LocalBlobStore).dir).toBe('/var/pra/blobs');
    }
  });

  test('an S3 endpoint means an S3-compatible store with path-style URLs', () => {
    expect(
      s3ClientConfigFromEnv({ S3_ENDPOINT: 'http://minio:9000', AWS_REGION: 'us-east-1' }),
    ).toEqual({
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      region: 'us-east-1',
    });
    expect(s3ClientConfigFromEnv({})).toEqual({});
  });
});
