// P-28: the GitHub poller without the App, with a `GitHubGateway` double in token mode. The first
// poll of a repository imports its open PRs and starts nothing; later polls turn each change into
// the `pull_request` delivery a webhook would bring (handled by the webhook path), once; a rate
// limit stops the poll until GitHub's reset; App mode turns the poller off.
import { DEFAULT_GITHUB_POLL_SCHEDULE } from '@pra/core';
import {
  eq,
  getAppSettings,
  getGithubPoller,
  getPullRequest,
  insertRun,
  schema,
  upsertRepository,
  writeAppSettings,
  type Repository,
} from '@pra/db';
import { aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { IntegrationError, toPullRequest, type GitHubPullRequest } from '@pra/integrations';
import { fixturePullRequest } from '@pra/integrations/testing';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { pollDelivery, pollGithub } from '../src/handlers/github-poll.ts';
import { createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let deps: TestWorkerDeps;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url });
  deps.github.setMode('token');
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await database?.drop();
});

beforeEach(async () => {
  deps.github.setMode('token');
  await deps.db.delete(schema.githubPoller);
});

const connect = (name: string, defaultLevel = 2): Promise<Repository> =>
  upsertRepository(deps.db, { slug: name, githubFullName: `acme/${name}`, defaultLevel });

let clock = Date.parse('2026-11-18T13:00:00Z');
/** GitHub's PR `number` of `repository`; each call is a later `updated_at`. */
function onGitHub(
  repository: Repository,
  number: number,
  patch: Partial<GitHubPullRequest> = {},
): GitHubPullRequest {
  clock += 60_000;
  const pr: GitHubPullRequest = {
    ...fixturePullRequest('pull_request.opened'),
    fullName: repository.githubFullName,
    headRepoFullName: repository.githubFullName,
    isFork: false,
    number,
    title: `PR ${number}`,
    headSha: `${number}`.padStart(40, 'c'),
    isDraft: false,
    state: 'open',
    commitsCount: 2,
    updatedAt: new Date(clock).toISOString(),
    ...patch,
  };
  deps.github.addPullRequest(pr);
  return pr;
}

const eventsOf = (repository: Repository) =>
  deps.db
    .select()
    .from(schema.githubEvents)
    .where(eq(schema.githubEvents.repositoryFullName, repository.githubFullName));

const runsOf = (pullRequestId: number) =>
  deps.db.select().from(schema.runs).where(eq(schema.runs.pullRequestId, pullRequestId));

const poll = () => pollGithub(deps, { force: true });

test('App mode: the poller is off and asks GitHub nothing', async () => {
  deps.github.setMode('app');
  const before = deps.github.calls.length;
  expect(await poll()).toEqual({ status: 'off' });
  expect(deps.github.calls.length).toBe(before);
});

test('the first poll imports the open PRs, records no delivery and starts no review', async () => {
  const repository = await connect('baseline-repo');
  onGitHub(repository, 1);
  onGitHub(repository, 2, { isDraft: true });

  const outcome = await poll();

  expect(outcome).toMatchObject({ status: 'polled', baselined: ['acme/baseline-repo'] });
  expect(await eventsOf(repository)).toEqual([]);
  const first = await getPullRequest(deps.db, repository.id, 1);
  expect(first).toMatchObject({ state: 'open', isDraft: false });
  expect(await runsOf(first!.id)).toEqual([]);
  // Imported from the list: one request for the repository, no PR read in full.
  expect(deps.github.callsOf('getPullRequest')).toEqual([]);
});

test('later changes become webhook deliveries, recorded once and handled by the webhook path', async () => {
  const repository = await connect('change-repo');
  onGitHub(repository, 1);
  onGitHub(repository, 2);
  onGitHub(repository, 4, { isDraft: true });
  await poll();

  onGitHub(repository, 1, { headSha: 'd'.repeat(40) });
  onGitHub(repository, 2, { state: 'closed', closedAt: new Date(clock).toISOString() });
  onGitHub(repository, 3);
  onGitHub(repository, 4, { isDraft: false });
  const outcome = await poll();

  expect(outcome).toMatchObject({ status: 'polled', baselined: [], failed: [] });
  const events = await eventsOf(repository);
  expect(events.map((e) => `${e.prNumber}:${e.action}`).sort()).toEqual([
    '1:synchronize',
    '2:closed',
    '3:opened',
    '4:ready_for_review',
  ]);
  expect(events.every((e) => e.deliveryId.startsWith(`poll-${repository.id}-`))).toBe(true);

  const outcomes = new Map<string, string>();
  for (const event of events) {
    outcomes.set(`${event.prNumber}:${event.action}`, await processGithubEvent(deps, event.id));
  }
  expect(outcomes.get('3:opened')).toBe('round_started');
  expect(outcomes.get('4:ready_for_review')).toBe('round_started');
  expect(await getPullRequest(deps.db, repository.id, 1)).toMatchObject({
    headSha: 'd'.repeat(40),
    commitsCount: 2,
  });
  expect((await getPullRequest(deps.db, repository.id, 2))?.state).toBe('closed');

  // Nothing changed since: no new delivery.
  await poll();
  expect(await eventsOf(repository)).toHaveLength(4);
});

test('the same change seen twice is one delivery (stable id, unique in github_events)', async () => {
  const repository = await connect('dedupe-repo');
  const pr = onGitHub(repository, 9);
  const first = pollDelivery(repository, null, pr, 'opened');
  const again = pollDelivery(repository, null, pr, 'opened');
  expect(again.deliveryId).toBe(first.deliveryId);
  expect(first.deliveryId).not.toContain(':');
  // The payload is what the webhook path reads.
  const payload = JSON.parse(new TextDecoder().decode(first.rawBody));
  expect(payload).toMatchObject({ action: 'opened', number: 9 });
  expect(toPullRequest(payload.pull_request)).toEqual(pr);
});

test('two polls at once: one takes the lease, the other skips', async () => {
  await connect('overlap-repo');
  const outcomes = await Promise.all([poll(), poll()]);
  expect(outcomes.map((o) => o.status).sort()).toEqual(['busy', 'polled']);
});

test('a tick outside the schedule does not poll; Poll now does', async () => {
  await writeAppSettings(deps.db, {
    ...(await getAppSettings(deps.db)).value,
    githubPoll: { ...DEFAULT_GITHUB_POLL_SCHEDULE, timeZone: 'Europe/Warsaw' },
  });
  // Saturday noon in Warsaw: the default window is Monday to Friday.
  const saturday = new Date('2026-11-21T11:00:00Z');
  expect(await pollGithub(deps, { now: saturday })).toEqual({ status: 'not_due' });
  expect((await pollGithub(deps, { now: saturday, force: true })).status).toBe('polled');
  // Monday 10:00 in Warsaw, the interval long passed.
  expect((await pollGithub(deps, { now: new Date('2026-11-23T09:00:00Z') })).status).toBe('polled');
});

test('a rate limit stops the poll and holds every poll until GitHub resets it', async () => {
  await connect('limited-repo');
  const resetAt = new Date(Date.now() + 30 * 60_000).toISOString();
  deps.github.failNext(
    'listOpenPullRequests',
    new IntegrationError('github_rate_limited', { resetAt }),
  );

  const outcome = await poll();

  expect(outcome).toMatchObject({ status: 'polled', rateLimitedUntil: new Date(resetAt) });
  const poller = await getGithubPoller(deps.db);
  expect(poller.backoffUntil?.toISOString()).toBe(resetAt);
  expect(poller.lastError).toEqual({ code: 'github_rate_limited', params: { resetAt } });
  expect(poller.leaseUntil).toBeNull();
  expect(await poll()).toEqual({ status: 'backoff', until: new Date(resetAt) });
});

test('CI of a PR under review is read again; other PRs cost no request', async () => {
  const repository = await connect('ci-repo');
  onGitHub(repository, 1);
  const idle = onGitHub(repository, 2);
  await poll();
  const pr = (await getPullRequest(deps.db, repository.id, 1))!;
  await insertRun(deps.db, aRun(pr.id, { status: 'running' }));
  deps.github.setCiChecks(repository.githubFullName, pr.headSha, [
    { name: 'build', source: 'check_run', state: 'failed' },
  ]);

  await poll();

  expect((await getPullRequest(deps.db, repository.id, 1))?.ciChecks).toEqual([
    expect.objectContaining({ name: 'build', conclusion: 'failure' }),
  ]);
  const ciReads = deps.github.callsOf('getCiStatus').map(([, sha]) => sha);
  expect(ciReads).toContain(pr.headSha);
  expect(ciReads).not.toContain(idle.headSha);
});
