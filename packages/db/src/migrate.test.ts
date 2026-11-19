import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, createDb } from './client.ts';
import { migrateDatabase } from './migrate.ts';
import { createQueue, JOBS } from './queue.ts';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from './testing/index.ts';

describe('on a database nobody migrated', () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase({ migrate: false });
  });
  afterAll(() => database.drop());

  test('the queue refuses to start instead of installing itself', async () => {
    const queue = createQueue(database.url, { max: 1 });
    queue.on('error', () => {});

    await expect(queue.start()).rejects.toThrow('pg-boss is not installed');
    await queue.stop({ graceful: false });
  });

  test('migrateDatabase installs the tables, pg-boss and its queues, and a rerun changes nothing', async () => {
    const first = await migrateDatabase(database.url);
    const second = await migrateDatabase(database.url);

    expect(first).toMatchObject({ applied: first.total, queueSchemaVersion: expect.any(Number) });
    expect(first.total).toBeGreaterThan(0);
    expect(second).toEqual({ ...first, applied: 0 });

    const db = createDb(database.url, { max: 1 });
    try {
      const queues = await db.execute<{ name: string }>(sql`select name from pgboss.queue`);
      expect(queues.rows.map((row) => row.name).sort()).toEqual(Object.values(JOBS).sort());
    } finally {
      await closeDb(db);
    }
  });

  test('a queue created with older settings gets the current ones on the next migrate', async () => {
    await migrateDatabase(database.url);
    const db = createDb(database.url, { max: 1 });
    try {
      await db.execute(sql`update pgboss.queue
        set retry_limit = 2, retry_delay = 0, retry_backoff = false, expire_seconds = 900
        where name = 'run.stage'`);

      await migrateDatabase(database.url);

      const queues = await db.execute<{
        name: string;
        retry_limit: number;
        retry_delay: number;
        retry_backoff: boolean;
        expire_seconds: number;
      }>(sql`select name, retry_limit, retry_delay, retry_backoff, expire_seconds
        from pgboss.queue where name = 'run.stage'`);
      expect(queues.rows).toEqual([
        expect.objectContaining({ name: 'run.stage', expire_seconds: 5 * 60 * 60 }),
      ]);
    } finally {
      await closeDb(db);
    }
  });
});
