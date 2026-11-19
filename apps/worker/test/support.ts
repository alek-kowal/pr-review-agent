// Worker test dependencies: doubles, temp dirs, and stored webhook deliveries.
import { FakeAgentRunner, FakeJudge } from '@pra/agents/testing';
import {
  closeDb,
  createDb,
  createQueue,
  recordGithubEvent,
  sql,
  upsertRepository,
  type Db,
  type GithubEvent,
  type JobName,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, testDatabaseUrl } from '@pra/db/testing';
import { CliGitMirror, LocalBlobStore } from '@pra/integrations';
import { createLogger } from '@pra/integrations/logging';
import {
  FakeClickUpGateway,
  FakeGitHubGateway,
  FakeSandbox,
  githubFixture,
  type GitHubFixtureName,
} from '@pra/integrations/testing';
import type { RepositoryConfig } from '@pra/core';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { withDefaults, type WorkerDeps, type WorkerDepsInput } from '../src/deps.ts';
import { NO_RUN_GATES } from '../src/run/gates.ts';
import { removeTree } from '../src/stages/review/prompt.ts';

export type TestWorkerDeps = WorkerDeps & {
  github: FakeGitHubGateway;
  agentRunner: FakeAgentRunner;
  judge: FakeJudge;
  sandbox: FakeSandbox;
  clickup: FakeClickUpGateway;
  blobStore: LocalBlobStore;
  /** Closes the pool and queue it created and removes its temp dir. */
  close: () => Promise<void>;
};

export type TestWorkerDepsOptions = Partial<Omit<WorkerDepsInput, 'db' | 'queue'>> & {
  /** Database URL; this run's shared test database by default. */
  url?: string;
  github?: FakeGitHubGateway;
  agentRunner?: FakeAgentRunner;
  judge?: FakeJudge;
  sandbox?: FakeSandbox;
  clickup?: FakeClickUpGateway;
};

/**
 * Worker deps on a test database: a started queue without maintenance (pg-boss sends need a
 * started instance), a silent logger, a `FakeGitHubGateway`, a `FakeAgentRunner`, a `FakeJudge`,
 * a `FakeSandbox`, a `FakeClickUpGateway`, and a temp dir for blobs, git and sessions. `startWorker` may start the same queue again (a no-op).
 */
export async function createTestWorkerDeps(
  options: TestWorkerDepsOptions = {},
): Promise<TestWorkerDeps> {
  const { url = testDatabaseUrl(), ...rest } = options;
  const root = mkdtempSync(path.join(tmpdir(), 'pra-worker-'));
  const db = createDb(url, { max: 3 });
  const queue = createQueue(url, { max: 3, supervise: false, schedule: false });
  queue.on('error', () => {});
  await queue.start();
  const deps = withDefaults({
    db,
    queue,
    logger: createLogger('worker', { NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    dataDir: path.join(root, 'data'),
    blobStore: new LocalBlobStore(path.join(root, 'blobs')),
    github: new FakeGitHubGateway(),
    gitMirror: new CliGitMirror({ rootDir: path.join(root, 'git') }),
    agentRunner: new FakeAgentRunner(),
    judge: new FakeJudge(),
    sandbox: new FakeSandbox(),
    clickup: new FakeClickUpGateway(),
    ...rest,
    // Without the pause, budget and slot gates: the shared test database keeps other tests'
    // runs, which would fill the agent slots. Gate tests pass `runGates: RUN_GATES`.
    extensions: { runGates: NO_RUN_GATES, ...rest.extensions },
  });
  return {
    ...(deps as TestWorkerDeps),
    async close() {
      await queue.stop({ graceful: false }).catch(() => {});
      await closeDb(db);
      // Knowledge directories are read-only.
      await removeTree(root);
    },
  };
}

/** A connected repository with a unique full name (`acme/repo-<hex>`). */
export function connectRepository(
  db: Db,
  patch: Partial<RepositoryConfig> = {},
): Promise<Repository> {
  return upsertRepository(db, aRepositoryConfig(patch));
}

export type StoreEventOptions = {
  /** The base repository's full name written into the payload. */
  fullName: string;
  /** Replaces the delivery's `action`. */
  action?: string;
  /** Fields merged into `pull_request` (for example `updated_at`, `title`). */
  pullRequest?: Record<string, unknown>;
  /** The head sha written into `pull_request.head.sha`. */
  headSha?: string;
  /** Top-level payload fields merged in (for example a `synchronize`'s `before` and `sender`). */
  payload?: Record<string, unknown>;
};

/**
 * Stores a fixture delivery the way the webhook route does (blob, then event row) with a new
 * delivery id and the repository renamed to `fullName`. A fork fixture keeps its head repository.
 */
export async function storeGithubEvent(
  deps: Pick<WorkerDeps, 'db' | 'blobStore'>,
  name: GitHubFixtureName,
  options: StoreEventOptions,
): Promise<GithubEvent> {
  const fixture = githubFixture(name);
  const payload = structuredClone(fixture.payload) as Payload;
  const pr = payload.pull_request;
  if (pr) {
    const baseName = pr.base.repo.full_name;
    pr.base.repo.full_name = options.fullName;
    if (pr.head.repo.full_name === baseName) pr.head.repo.full_name = options.fullName;
    if (options.headSha) pr.head.sha = options.headSha;
    Object.assign(pr, options.pullRequest);
  }
  if (payload.repository) payload.repository.full_name = options.fullName;
  if (options.action) payload.action = options.action;
  if (options.payload) Object.assign(payload, options.payload);

  const deliveryId = randomUUID();
  const blobKey = `github-events/${deliveryId}.json`;
  await deps.blobStore.put(blobKey, Buffer.from(JSON.stringify(payload)), {
    contentType: 'application/json',
  });
  const { event } = await recordGithubEvent(deps.db, {
    deliveryId,
    event: fixture.event,
    action: typeof payload.action === 'string' ? payload.action : null,
    repositoryFullName: options.fullName,
    prNumber: pr?.number ?? null,
    blobKey,
  });
  return event;
}

type Payload = {
  action?: unknown;
  repository?: { full_name: string };
  pull_request?: {
    number: number;
    head: { sha: string; repo: { full_name: string } };
    base: { repo: { full_name: string } };
  };
};

/** Jobs of one queue whose data field `field` equals `value` (test files share one database). */
export async function jobsWhere(
  db: Db,
  name: JobName,
  field: string,
  value: string | number,
): Promise<{ id: string; data: Record<string, unknown>; singletonKey: string | null }[]> {
  const result = await db.execute<{
    id: string;
    data: Record<string, unknown>;
    singleton_key: string | null;
  }>(
    sql`select id, data, singleton_key from pgboss.job
        where name = ${name} and data->>${field} = ${String(value)}`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    data: row.data,
    singletonKey: row.singleton_key,
  }));
}
