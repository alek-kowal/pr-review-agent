// Builds the api the way `src/main.ts` does, on test dependencies.
import { closeDb, createDb, createQueue } from '@pra/db';
import { testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { onTestFinished } from 'vitest';
import type { AppDeps } from '../src/app.ts';
import { buildServer } from '../src/server.ts';

/**
 * The api on this test run's database (lazy pool) and a queue that is never started. Pass
 * `deps` to replace either; whatever the helper creates it also closes after the test.
 */
async function build(deps: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  const url = testDatabaseUrl();
  const db = deps.db ?? createDb(url, { max: 2 });
  const queue = deps.queue ?? createQueue(url);
  const app = await buildServer({ db, queue }, { logger: false });
  await app.ready();

  onTestFinished(async () => {
    await app.close();
    if (!deps.db) await closeDb(db);
  });
  return app;
}

export { build };
