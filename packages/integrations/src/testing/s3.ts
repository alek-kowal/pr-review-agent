import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { execa } from 'execa';

/** Shared by every test run; contract tests write under `contract/<uuid>/`. */
export const S3_TEST_BUCKET = 'pra-test';

/** The local MinIO's throwaway root credentials (docker-compose.yml, CI). */
const TEST_CREDENTIALS = { accessKeyId: 'pra', secretAccessKey: 'pra-local-only' };

/**
 * The MinIO for S3 tests: `S3_TEST_ENDPOINT` (CI), else the ephemeral host port of the shared
 * `pra-minio-1` container (`docker compose --profile s3 up -d minio`). `null` when neither exists.
 */
export async function s3TestEndpoint(): Promise<string | null> {
  if (process.env.S3_TEST_ENDPOINT) return process.env.S3_TEST_ENDPOINT;
  try {
    const { stdout } = await execa('docker', ['port', 'pra-minio-1', '9000/tcp'], {
      timeout: 5_000,
    });
    const hostPort = stdout.split('\n')[0]?.trim().replace('0.0.0.0', '127.0.0.1');
    return hostPort ? `http://${hostPort}` : null;
  } catch {
    return null;
  }
}

/** A client for the test MinIO, with `S3_TEST_BUCKET` created if it is missing. */
export async function s3TestClient(endpoint: string): Promise<S3Client> {
  const client = new S3Client({
    endpoint,
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: TEST_CREDENTIALS,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: S3_TEST_BUCKET }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
  }
  return client;
}
