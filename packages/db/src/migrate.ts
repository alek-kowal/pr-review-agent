import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { closeDb, createDb, type Db } from './client.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export type MigrationResult = { applied: number; total: number };

/**
 * Applies pending Drizzle migrations. Only `pnpm db:migrate` and the test setup call this;
 * apps never migrate on start.
 */
export async function migrateDatabase(url: string): Promise<MigrationResult> {
  const db = createDb(url, { max: 1 });
  try {
    const before = await countApplied(db);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const total = await countApplied(db);
    return { applied: total - before, total };
  } finally {
    await closeDb(db);
  }
}

async function countApplied(db: Db): Promise<number> {
  const table = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!table.rows[0]?.exists) return 0;
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  );
  return result.rows[0]?.count ?? 0;
}
