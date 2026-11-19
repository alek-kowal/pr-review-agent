// Runs a real pg-boss worker, so it uses its own database: a worker on the shared test database
// would take other files' jobs.
import { eq, JOBS, schema, sendJob } from '@pra/db';
import { createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createTestWorkerDeps, type TestWorkerDeps } from '../test/support.ts';
import { startWorker, type RunningWorker } from './worker.ts';

let database: TestDatabase;
let deps: TestWorkerDeps;
let worker: RunningWorker;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url });
  worker = await startWorker(deps, { pollingIntervalSeconds: 0.5 });
}, 30_000);

afterAll(async () => {
  await worker?.stop();
  await deps?.close();
  await database?.drop();
});

test('a smoke job writes a smoke row within 5 s', async () => {
  const note = `smoke ${randomUUID()}`;

  await sendJob(deps.queue, JOBS.smoke, { note });

  await vi.waitFor(
    async () => {
      const rows = await deps.db.select().from(schema.smoke).where(eq(schema.smoke.note, note));
      expect(rows).toHaveLength(1);
    },
    { timeout: 5_000, interval: 100 },
  );
});
