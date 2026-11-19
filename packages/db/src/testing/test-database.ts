import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrateDatabase } from '../migrate.ts';

/** The local Docker Compose db (`docker compose up -d db`); used when DATABASE_URL is unset. */
export const LOCAL_DATABASE_URL = 'postgres://pra:pra@localhost:5432/pra';
/** Tests connect here only to create and drop their own databases. */
export const MAINTENANCE_DATABASE = 'pra_test';

const RUN_DATABASE = /^pra_test_([0-9a-z]+)_[0-9a-f]{8}$/;
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export type TestDatabase = { name: string; url: string; drop: () => Promise<void> };

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Creates and migrates a database that belongs to one test run, so runs from several worktrees
 * share one Postgres without touching each other's data. The URL is DATABASE_URL (or the local
 * compose db) with the database name changed.
 */
export async function createTestDatabase(
  baseUrl: string = process.env.DATABASE_URL || LOCAL_DATABASE_URL,
): Promise<TestDatabase> {
  const maintenanceUrl = withDatabase(baseUrl, MAINTENANCE_DATABASE);
  const name = `pra_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

  await withClient(maintenanceUrl, async (client) => {
    await dropStaleDatabases(client);
    await client.query(`create database "${name}"`);
  });

  const url = withDatabase(baseUrl, name);
  const drop = () =>
    withClient(maintenanceUrl, async (client) => {
      await client.query(`drop database if exists "${name}" with (force)`);
    });

  try {
    await migrateDatabase(url);
  } catch (error) {
    await drop();
    throw error;
  }
  return { name, url, drop };
}

/** Removes databases left behind by test runs that crashed before their teardown. */
async function dropStaleDatabases(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ datname: string }>(
    `select datname from pg_database where datname like 'pra\\_test\\_%'`,
  );
  const now = Date.now();
  for (const { datname } of rows) {
    const createdAt = Number.parseInt(RUN_DATABASE.exec(datname)?.[1] ?? '', 36);
    if (Number.isNaN(createdAt) || now - createdAt < STALE_AFTER_MS) continue;
    // Another run may be dropping the same database right now.
    await client.query(`drop database if exists "${datname}" with (force)`).catch(() => {});
  }
}

async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test Postgres at ${redactPassword(url)}. Start it with ` +
        '`docker compose up -d db`, or set DATABASE_URL.',
      { cause: error },
    );
  }
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

function redactPassword(url: string): string {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = '***';
  return parsed.toString();
}
