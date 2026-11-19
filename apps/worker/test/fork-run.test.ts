// S-16-T2: the worker builds every stage from the core plan, so a fork run never calls the
// Sandbox, and nothing starts a round for a fork by itself (webhook, reconcile poll, fix check on
// push). Own database: the reconcile poll reads every connected repository.
import {
  eq,
  getPullRequest,
  importInstructionV1,
  insertRun,
  JOBS,
  schema,
  upsertPullRequest,
  upsertRepository,
  type PullRequest,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import {
  createGitFixture,
  FakeSandbox,
  fixturePullRequest,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { reconcileRepositories } from '../src/handlers/reconcile.ts';
import { startFixCheckOnPush } from '../src/run/chains.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import type { ChecksOutput } from '../src/stages/checks.ts';
import type { VerifyOutput } from '../src/stages/verify.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

const FILE = 'apps/demo/src/edges.ts';
const QUOTE = 'export const label = (edge: { name: string }) => edge.name.trim();';
const FORK_READ_ONLY = { code: 'fork_read_only', params: {} };

const stageJobs = () => deps.queue.findJobs(JOBS.runStage, { queued: true });

async function stageOutput<T>(runId: number, stage: string) {
  const rows = await deps.db
    .select()
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.runId, runId));
  return rows.find((row) => row.stage === stage)?.output as T;
}

describe('a manual round on a fork', () => {
  test('completes with zero Sandbox calls: no install, no reproduction', async () => {
    const repository = await connectRepository(deps.db, {
      installCommand: 'pnpm install --offline --frozen-lockfile',
      fetchCommand: 'pnpm fetch',
    });
    for (const [fileKey, content] of [
      ['prompt-verifier.md', 'Try to refute the finding.'],
      ['verify-rules.md', '# Script\n\nExit 0 when the bug shows, 3 when it does not.'],
    ] as const) {
      await importInstructionV1(deps.db, {
        scope: 'repository',
        repositoryId: repository.id,
        fileKey,
        content,
      });
    }
    const { pullRequest } = await upsertPullRequest(
      deps.db,
      aPullRequest(repository.id, {
        headSha: fixture.headSha,
        baseSha: fixture.baseSha,
        isFork: true,
      }),
    );
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 3, headSha: fixture.headSha, trigger: 'manual' }),
    );
    const sandbox = new FakeSandbox();
    deps.sandbox = sandbox;
    deps.agentRunner.enqueue({
      output: {
        summary: 's',
        risk: 'low',
        findings: [
          {
            title: 'Empty name',
            severity: 'blocker',
            file: FILE,
            line: 1,
            scenario: 'When the name is empty, the edge shows nothing.',
            suggestion: 'Fall back to the edge id.',
          },
        ],
        questions: [],
        notChecked: [],
      },
    });
    deps.agentRunner.enqueue({
      output: {
        verdict: 'confirmed',
        reason: 'Read the code.',
        evidence: [{ file: FILE, line: 1, quote: QUOTE }],
        script: 'process.exit(0)',
        remedy: { kind: 'obvious', why: 'Fall back.' },
      },
    });

    for (const stage of ['checks', 'task', 'change_type', 'review', 'verify']) {
      expect(await executeStage(deps, run.id, stage)).toBe('succeeded');
    }

    expect(sandbox.calls).toEqual([]);
    const checks = await stageOutput<ChecksOutput>(run.id, 'checks');
    expect(checks.install).toMatchObject({ status: 'skipped', offReason: FORK_READ_ONLY });
    const verify = await stageOutput<VerifyOutput>(run.id, 'verify');
    expect(verify.runScripts).toBe(false);
    const [stored] = await deps.db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
    expect(stored).toMatchObject({ status: 'completed' });
  });
});

describe('nothing starts a round for a fork by itself', () => {
  test('a ready_for_review event on a fork queues nothing', async () => {
    const repository = await connectRepository(deps.db);
    const before = (await stageJobs()).length;
    const event = await storeGithubEvent(deps, 'pull_request.opened-fork', {
      fullName: repository.githubFullName,
      action: 'ready_for_review',
    });

    expect(await processGithubEvent(deps, event.id)).toBe('fork');

    expect(await stageJobs()).toHaveLength(before);
    const [fork] = await deps.db
      .select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.repositoryId, repository.id));
    expect(fork?.isFork).toBe(true);
    const runs = await deps.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.pullRequestId, fork!.id));
    expect(runs).toEqual([]);
  });

  test('a poll that finds a ready fork PR imports it and queues nothing', async () => {
    const repository = await upsertRepository(deps.db, {
      slug: 'fork-poll',
      githubFullName: 'acme/fork-poll',
      defaultLevel: 3,
    });
    deps.github.addPullRequest({
      ...fixturePullRequest('pull_request.opened-fork'),
      fullName: repository.githubFullName,
      number: 41,
      isDraft: false,
      isFork: true,
      updatedAt: '2026-11-19T10:00:00Z',
    });
    const before = (await stageJobs()).length;

    await reconcileRepositories(deps);

    const pr = await getPullRequest(deps.db, repository.id, 41);
    expect(pr).toMatchObject({ isFork: true, isDraft: false, state: 'open' });
    const runs = await deps.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.pullRequestId, pr!.id));
    expect(runs).toEqual([]);
    expect(await stageJobs()).toHaveLength(before);
  });

  test('a push of the expected fix head on a fork starts no fix check', async () => {
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(
      deps.db,
      aPullRequest(repository.id, { isFork: true }),
    );
    // The chain expects exactly this head: only the fork rule keeps the fix check from starting.
    const chainId = randomUUID();
    await deps.db
      .insert(schema.roundChains)
      .values({ id: chainId, pullRequestId: pullRequest.id, expectedHeadSha: pullRequest.headSha });
    await insertRun(
      deps.db,
      aRun(pullRequest.id, { chainId, status: 'completed', finishedAt: new Date() }),
    );

    const started = await startFixCheckOnPush(deps, pullRequest as PullRequest, undefined);

    expect(started).toBeNull();
    const runs = await deps.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.pullRequestId, pullRequest.id));
    expect(runs.map((run) => run.trigger)).not.toContain('own_fix');
  });
});
