import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema> & { $client: pg.Pool };

export type CreateDbOptions = {
  /** Pool size; node-postgres defaults to 10. */
  max?: number;
  /** How long a query waits for a connection before failing. */
  connectionTimeoutMillis?: number;
  /** Errors from idle pooled connections (e.g. Postgres restarted). The pool drops the client. */
  onPoolError?: (error: Error) => void;
};

/**
 * A Drizzle client over a lazy pool: nothing connects until the first query, so callers start
 * even when Postgres is down. Close it with `closeDb`.
 */
export function createDb(url: string, options: CreateDbOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });
  // Without a listener, an idle connection error would crash the process.
  pool.on('error', options.onPoolError ?? (() => {}));
  return drizzle({ client: pool, schema });
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}

/** What queries need: the client or a transaction (`db.transaction(async (tx) => ...)`). */
export type Executor = Pick<Db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>;
