import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { closeDb, createDb, type Db } from './client.ts';
import { migrateQueue } from './queue.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export type MigrationResult = {
  /** Drizzle migrations applied by this call, and in total. */
  applied: number;
  total: number;
  /** pg-boss schema version after install or upgrade. */
  queueSchemaVersion: number | null;
};

/**
 * Applies pending Drizzle migrations, then installs or upgrades pg-boss and its queues. Only
 * `pnpm db:migrate` and the test setup call this; apps never migrate on start.
 */
export async function migrateDatabase(url: string): Promise<MigrationResult> {
  const db = createDb(url, { max: 1 });
  let applied: number;
  let total: number;
  try {
    const before = await countApplied(db);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    total = await countApplied(db);
    applied = total - before;
  } finally {
    await closeDb(db);
  }
  const { schemaVersion } = await migrateQueue(url);
  return { applied, total, queueSchemaVersion: schemaVersion };
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
