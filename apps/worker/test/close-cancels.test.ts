// S-09-T5: a `pull_request.closed` webhook cancels the PR's active run as PR Review Agent: the
// session in flight is aborted, the run ends `cancelled`, and no GitHub comment is posted.
import type { AgentRunResult } from '@pra/agents';
import {
  getRun,
  insertRun,
  timelineOf,
  upsertPullRequest,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import {
  createGitFixture,
  fixturePullRequest,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;
const prNumber = fixturePullRequest('pull_request.closed').number;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

async function openPr(): Promise<PullRequest> {
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, {
      number: prNumber,
      state: 'open',
      headSha: fixture.headSha,
      baseSha: fixture.baseSha,
    }),
  );
  return pullRequest;
}

const close = async () => {
  const event = await storeGithubEvent(deps, 'pull_request.closed', {
    fullName: repository.githubFullName,
    headSha: fixture.headSha,
  });
  return processGithubEvent(deps, event.id);
};

const cancelledEntries = async (pullRequestId: number) =>
  (await timelineOf(deps.db, pullRequestId)).filter((e) => e.kind === 'run_cancelled');

test('a close during Review aborts the session and the run ends cancelled by the bot', async () => {
  const pullRequest = await openPr();
  const run = await insertRun(deps.db, aRun(pullRequest.id, { headSha: fixture.headSha }));
  let inSession!: () => void;
  const sessionStarted = new Promise<void>((resolve) => (inSession = resolve));
  let aborted = false;

  deps.agentRunner.enqueue(async (input): Promise<AgentRunResult<unknown>> => {
    input.onProgress!({
      usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0.01,
      turns: 1,
    });
    inSession();
    await new Promise<void>((resolve) =>
      input.signal!.addEventListener('abort', () => resolve(), { once: true }),
    );
    aborted = true;
    return {
      status: 'cancelled',
      output: null,
      error: { code: 'cancelled', params: {} },
      usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0.01,
      costSource: 'computed',
      turns: 1,
      durationMs: 300,
      transcript: [],
    };
  });

  const stage = executeStage(deps, run.id, 'review');
  await sessionStarted;
  await close();

  expect(await stage).toBe('cancelled');
  expect(aborted).toBe(true);
  expect(await getRun(deps.db, run.id)).toMatchObject({
    status: 'cancelled',
    cancelledBy: 'bot',
    cancelReason: 'pr_closed',
  });
  // "Run cancelled: PR closed", and nothing said on GitHub.
  await vi.waitFor(async () =>
    expect(await cancelledEntries(pullRequest.id)).toEqual([
      expect.objectContaining({
        actor: 'bot',
        params: expect.objectContaining({ reason: 'pr_closed' }),
      }),
    ]),
  );
  expect(deps.github.comments).toEqual([]);
});

test('a close with no active run does nothing', async () => {
  const pullRequest = await openPr();
  const finished = await insertRun(
    deps.db,
    aRun(pullRequest.id, { headSha: fixture.headSha, status: 'completed' }),
  );
  const before = (await cancelledEntries(pullRequest.id)).length;

  await close();

  expect(await getRun(deps.db, finished.id)).toMatchObject({
    status: 'completed',
    cancelRequestedAt: null,
  });
  expect(await cancelledEntries(pullRequest.id)).toHaveLength(before);
  expect(deps.github.comments).toEqual([]);
});
