import { closeDb, createDb, createQueue, eq, JOBS, schema, sendJob } from '@pra/db';
import { testDatabaseUrl } from '@pra/db/testing';
import { createLogger } from '@pra/integrations/logging';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { startWorker, type RunningWorker } from './worker.ts';

const url = testDatabaseUrl();
const db = createDb(url, { max: 2 });
const queue = createQueue(url, { max: 3 });
const logger = createLogger('worker', { NODE_ENV: 'test', LOG_LEVEL: 'silent' });
let worker: RunningWorker;

beforeAll(async () => {
  worker = await startWorker({ db, queue, logger }, { pollingIntervalSeconds: 0.5 });
});

afterAll(async () => {
  await worker.stop();
  await closeDb(db);
});

test('a smoke job writes a smoke row within 5 s', async () => {
  const note = `smoke ${randomUUID()}`;

  await sendJob(queue, JOBS.smoke, { note });

  await vi.waitFor(
    async () => {
      const rows = await db.select().from(schema.smoke).where(eq(schema.smoke.note, note));
      expect(rows).toHaveLength(1);
    },
    { timeout: 5_000, interval: 100 },
  );
});
