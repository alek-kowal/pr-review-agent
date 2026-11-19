// Builds the api the way `src/main.ts` does, on test dependencies.
import { closeDb, createDb, createQueue } from '@pra/db';
import { testDatabaseUrl } from '@pra/db/testing';
import { LocalBlobStore } from '@pra/integrations';
import { FakeGitHubGateway } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { onTestFinished } from 'vitest';
import type { AppDeps } from '../src/app.ts';
import { buildServer } from '../src/server.ts';

/** `FakeGitHubGateway` and a blob store in a fresh temp dir, for deps a test does not pass. */
function testDoubles(): Pick<AppDeps, 'github' | 'blobStore'> {
  return {
    github: new FakeGitHubGateway(),
    blobStore: new LocalBlobStore(mkdtempSync(path.join(tmpdir(), 'pra-api-blobs-'))),
  };
}

/**
 * The api on this test run's database (lazy pool), a queue that is never started and test
 * doubles. Pass `deps` to replace any; whatever the helper creates it also closes after the test.
 */
async function build(deps: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  const url = testDatabaseUrl();
  const db = deps.db ?? createDb(url, { max: 2 });
  const queue = deps.queue ?? createQueue(url);
  const app = await buildServer({ ...testDoubles(), ...deps, db, queue }, { logger: false });
  await app.ready();

  onTestFinished(async () => {
    await app.close();
    if (!deps.db) await closeDb(db);
  });
  return app;
}

/**
 * Headers the web client sends on state-changing calls; `inject` uses `Host: localhost:80`. The
 * CSRF guard (src/plugins/csrf.ts) rejects a POST, PUT, PATCH or DELETE without them.
 */
const SAME_ORIGIN = { 'x-pra-request': '1', origin: 'http://localhost' } as const;

export { build, SAME_ORIGIN, testDoubles };
