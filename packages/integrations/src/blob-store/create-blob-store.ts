import { S3Client } from '@aws-sdk/client-s3';
import type { BlobStore } from './blob-store.ts';
import { localBlobStoreFromEnv } from './local-blob-store.ts';
import { S3BlobStore, s3ClientConfigFromEnv } from './s3-blob-store.ts';

/**
 * The one place that picks the blob store for api and worker: S3 when `S3_BUCKET` is set (with
 * `S3_ENDPOINT` and the AWS default credential chain), otherwise the local store on `BLOB_DIR`.
 */
export function createBlobStore(env: NodeJS.ProcessEnv = process.env): BlobStore {
  const bucket = env.S3_BUCKET;
  if (bucket) {
    return new S3BlobStore({ bucket, client: new S3Client(s3ClientConfigFromEnv(env)) });
  }
  return localBlobStoreFromEnv(env);
}
