import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { closeDb, createDb, schema } from './index.ts';
import { testDatabaseUrl } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 2 });
afterAll(() => closeDb(db));

test('inserts and reads a smoke row', async () => {
  const [inserted] = await db.insert(schema.smoke).values({ note: 'hello' }).returning();

  const rows = await db.select().from(schema.smoke).where(eq(schema.smoke.id, inserted!.id));

  expect(rows).toEqual([{ id: inserted!.id, note: 'hello', createdAt: expect.any(Date) }]);
});
