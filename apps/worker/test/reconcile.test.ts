// S-03-T14: the reconcile poll corrects what webhooks missed, with a `GitHubGateway` double. It
// imports open PRs it does not know without starting a review, marks a PR closed while webhooks
// were down as closed and cancels its active run, and a poll with nothing new writes nothing.
import {
  eq,
  getPullRequest,
  getRun,
  insertRun,
  schema,
  timelineOf,
  upsertPullRequest,
  upsertRepository,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import type { GitHubPullRequest } from '@pra/integrations';
import { fixturePullRequest } from '@pra/integrations/testing';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { reconcileRepositories } from '../src/handlers/reconcile.ts';
import { createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let deps: TestWorkerDeps;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await database?.drop();
});

const connect = (name: string): Promise<Repository> =>
  upsertRepository(deps.db, { slug: name, githubFullName: `acme/${name}`, defaultLevel: 1 });

/** GitHub's PR `number` of `repository`, updated after any stored snapshot. */
function onGitHub(
  repository: Repository,
  number: number,
  patch: Partial<GitHubPullRequest> = {},
): GitHubPullRequest {
  const pr: GitHubPullRequest = {
    ...fixturePullRequest('pull_request.opened'),
    fullName: repository.githubFullName,
    number,
    title: `PR ${number}`,
    headSha: `${number}`.padStart(40, 'c'),
    updatedAt: '2026-11-18T13:00:00Z',
    ...patch,
  };
  deps.github.addPullRequest(pr);
  return pr;
}

const runsOf = (pullRequestId: number) =>
  deps.db.select().from(schema.runs).where(eq(schema.runs.pullRequestId, pullRequestId));

const stateChangesOf = (pullRequestId: number) =>
  deps.db
    .select()
    .from(schema.prStateChanges)
    .where(eq(schema.prStateChanges.pullRequestId, pullRequestId));

const reconciledEntries = async (pullRequestId: number) =>
  (await timelineOf(deps.db, pullRequestId)).filter((e) => e.kind === 'pr_reconciled');

test('three open PRs unknown to the DB are imported with zero runs created', async () => {
  const repository = await connect('import-repo');
  onGitHub(repository, 1);
  onGitHub(repository, 2, { isDraft: true });
  onGitHub(repository, 3, { commitsCount: 5 });

  const result = await reconcileRepositories(deps);

  expect(result.corrected).toEqual([
    'acme/import-repo#1',
    'acme/import-repo#2',
    'acme/import-repo#3',
  ]);
  for (const number of [1, 2, 3]) {
    const pr = await getPullRequest(deps.db, repository.id, number);
    expect(pr).toMatchObject({ state: 'open', title: `PR ${number}`, isDraft: number === 2 });
    expect(await runsOf(pr!.id)).toEqual([]);
    expect(await reconciledEntries(pr!.id)).toEqual([
      expect.objectContaining({
        actor: 'bot',
        params: expect.objectContaining({ corrections: ['imported'] }),
      }),
    ]);
    expect(await stateChangesOf(pr!.id)).toEqual([
      expect.objectContaining({
        reason: { code: 'reconciled', params: { corrections: ['imported'] } },
      }),
    ]);
  }
  expect((await getPullRequest(deps.db, repository.id, 3))?.commitsCount).toBe(5);
  // Nothing is queued for a review either.
  expect(await deps.queue.findJobs('run.stage')).toEqual([]);
});

test('a PR closed while webhooks were down is marked closed and its active run cancelled', async () => {
  const repository = await connect('closed-repo');
  const { pullRequest: closing } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { number: 7, state: 'open' }),
  );
  const run = await insertRun(deps.db, aRun(closing.id, { status: 'queued' }));
  onGitHub(repository, 7, {
    state: 'closed',
    closedAt: '2026-11-18T13:00:00Z',
    headSha: closing.headSha,
  });
  // A push the webhook missed, and a PR GitHub still lists as it is stored.
  const { pullRequest: pushed } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { number: 8, headSha: 'a'.repeat(40) }),
  );
  const { pullRequest: same } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { number: 9, headSha: 'd'.repeat(40) }),
  );
  onGitHub(repository, 8, { headSha: 'b'.repeat(40) });
  deps.github.addPullRequest({
    ...onGitHub(repository, 9),
    headSha: same.headSha,
    isDraft: same.isDraft,
  });
  deps.github.calls.length = 0;

  const result = await reconcileRepositories(deps);

  expect(result.corrected).toEqual(['acme/closed-repo#8', 'acme/closed-repo#7']);
  expect(await getPullRequest(deps.db, repository.id, 7)).toMatchObject({ state: 'closed' });
  expect(await getRun(deps.db, run.id)).toMatchObject({
    status: 'cancelled',
    cancelledBy: 'bot',
    cancelReason: 'pr_closed',
  });
  expect(await reconciledEntries(closing.id)).toEqual([
    expect.objectContaining({ params: expect.objectContaining({ corrections: ['closed'] }) }),
  ]);
  await vi.waitFor(async () =>
    expect((await timelineOf(deps.db, closing.id)).map((e) => e.kind)).toContain('run_cancelled'),
  );
  expect(await getPullRequest(deps.db, repository.id, 8)).toMatchObject({
    headSha: 'b'.repeat(40),
  });
  expect(await reconciledEntries(pushed.id)).toEqual([
    expect.objectContaining({ params: expect.objectContaining({ corrections: ['head'] }) }),
  ]);
  // The list has what #9 needs: it is not fetched in full, nor written.
  expect(deps.github.callsOf('getPullRequest')).toEqual([
    ['acme/closed-repo', 8],
    ['acme/closed-repo', 7],
  ]);
  expect(await reconciledEntries(same.id)).toEqual([]);
});

test('a second poll with no changes writes nothing', async () => {
  const repository = await connect('quiet-repo');
  onGitHub(repository, 1);
  await reconcileRepositories(deps);
  const pr = (await getPullRequest(deps.db, repository.id, 1))!;
  const timeline = (await timelineOf(deps.db, pr.id)).length;
  const changes = (await stateChangesOf(pr.id)).length;
  deps.github.calls.length = 0;

  const result = await reconcileRepositories(deps);

  expect(result).toEqual({ corrected: [], failed: [] });
  expect(deps.github.callsOf('getPullRequest')).toEqual([]);
  expect(await getPullRequest(deps.db, repository.id, 1)).toEqual(pr);
  expect(await timelineOf(deps.db, pr.id)).toHaveLength(timeline);
  expect(await stateChangesOf(pr.id)).toHaveLength(changes);
});

test('CI that finished while webhooks were down is stored once', async () => {
  const repository = await connect('ci-repo');
  const github = onGitHub(repository, 7);
  await reconcileRepositories(deps);
  deps.github.setCiChecks(repository.githubFullName, github.headSha, [
    { name: 'build', source: 'check_run', state: 'passed' },
    { name: 'lint', source: 'check_run', state: 'failed' },
  ]);

  const result = await reconcileRepositories(deps);

  expect(result.corrected).toContain('acme/ci-repo#7');
  const pr = (await getPullRequest(deps.db, repository.id, 7))!;
  expect(pr.ciSha).toBe(github.headSha);
  expect(pr.ciChecks).toEqual([
    { name: 'build', conclusion: 'success' },
    { name: 'lint', conclusion: 'failure' },
  ]);
  expect((await reconciledEntries(pr.id)).at(-1)?.params).toMatchObject({ corrections: ['ci'] });

  const again = await reconcileRepositories(deps);
  expect(again.corrected).not.toContain('acme/ci-repo#7');
  expect(await getPullRequest(deps.db, repository.id, 7)).toEqual(pr);
});

test('a repository GitHub cannot list is skipped; the others are still polled', async () => {
  const repository = await connect('zz-later-repo');
  onGitHub(repository, 4);
  deps.github.failNext(
    'listOpenPullRequests',
    Object.assign(new Error('Not Found'), { status: 404 }),
  );

  const result = await reconcileRepositories(deps);

  expect(result.failed).toHaveLength(1);
  expect(result.corrected).toEqual(['acme/zz-later-repo#4']);
});
