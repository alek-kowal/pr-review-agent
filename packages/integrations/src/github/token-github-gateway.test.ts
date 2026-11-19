// P-28: the token gateway against msw (nothing reaches GitHub): conditional requests, the rate
// limit and its back-off, and the token on reads.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { fixturePullRequest } from '../testing/index.ts';
import { toPullRequest, toRawPullRequest } from './github-gateway.ts';
import { TokenGitHubGateway } from './token-github-gateway.ts';

const API = 'https://api.github.com';
const REPO = 'polling-test/sample-repo';
const RESET = 1_900_000_000; // seconds

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const limits = (remaining: number) => ({
  'x-ratelimit-limit': '60',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(RESET),
});

function rawPr(number: number, draft = false) {
  return toRawPullRequest({
    ...fixturePullRequest('pull_request.opened'),
    fullName: REPO,
    headRepoFullName: REPO,
    number,
    isDraft: draft,
  });
}

describe('TokenGitHubGateway', () => {
  test('sends the token and reads the open PRs with their snapshot', async () => {
    const auth: (string | null)[] = [];
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, ({ request }) => {
        auth.push(request.headers.get('authorization'));
        return HttpResponse.json([rawPr(9101), rawPr(9102, true)], { headers: limits(59) });
      }),
    );
    const github = new TokenGitHubGateway({ token: 'pat', missingEnv: [] });
    const open = await github.listOpenPullRequests(REPO);
    expect(github.mode).toBe('token');
    expect(auth).toEqual(['token pat']);
    expect(open.map((pr) => [pr.number, pr.isDraft, pr.snapshot.fullName])).toEqual([
      [9101, false, REPO],
      [9102, true, REPO],
    ]);
    expect(github.rateLimit).toEqual({
      limit: 60,
      remaining: 59,
      resetAt: new Date(RESET * 1000).toISOString(),
    });
    expect(await github.gitToken()).toBe('pat');
  });

  test('anonymous mode sends no authorization', async () => {
    const auth: (string | null)[] = [];
    server.use(
      http.get(`${API}/repos/${REPO}`, ({ request }) => {
        auth.push(request.headers.get('authorization'));
        return HttpResponse.json({ full_name: REPO, default_branch: 'main', private: false });
      }),
    );
    const github = new TokenGitHubGateway({ missingEnv: [] });
    expect(github.mode).toBe('anonymous');
    expect(await github.getRepository(REPO)).toEqual({
      fullName: REPO,
      defaultBranch: 'main',
      private: false,
    });
    expect(auth).toEqual([null]);
    expect(await github.gitToken()).toBeUndefined();
  });

  test('a repository GitHub does not show is null', async () => {
    server.use(
      http.get(`${API}/repos/${REPO}`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );
    expect(await new TokenGitHubGateway({ missingEnv: [] }).getRepository(REPO)).toBeNull();
  });

  test('asks again with the ETag and reuses the answer on 304', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, ({ request }) => {
        const etag = request.headers.get('if-none-match');
        seen.push(etag);
        if (etag === '"v1"') return new HttpResponse(null, { status: 304, headers: limits(58) });
        return HttpResponse.json([rawPr(9101)], { headers: { ...limits(59), etag: '"v1"' } });
      }),
    );
    const github = new TokenGitHubGateway({ token: 'pat', missingEnv: [] });
    const first = await github.listOpenPullRequests(REPO);
    const second = await github.listOpenPullRequests(REPO);
    expect(seen).toEqual([null, '"v1"']);
    expect(second).toEqual(first);
    expect(github.rateLimit?.remaining).toBe(58);
  });

  test('a used-up limit refuses with the reset time and sends nothing until then', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, () => {
        calls++;
        return HttpResponse.json(
          { message: 'API rate limit exceeded' },
          { status: 403, headers: limits(0) },
        );
      }),
    );
    const clock = { now: (RESET - 600) * 1000 };
    const github = new TokenGitHubGateway({ missingEnv: [], now: () => clock.now });
    const resetAt = new Date(RESET * 1000).toISOString();
    await expect(github.listOpenPullRequests(REPO)).rejects.toMatchObject({
      code: 'github_rate_limited',
      params: { resetAt },
    });
    await expect(github.listOpenPullRequests(REPO)).rejects.toMatchObject({
      code: 'github_rate_limited',
    });
    expect(calls).toBe(1);

    clock.now = RESET * 1000 + 1;
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, () => HttpResponse.json([], { headers: limits(60) })),
    );
    expect(await github.listOpenPullRequests(REPO)).toEqual([]);
  });

  test('the last request of the hour blocks the next one without sending it', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, () => {
        calls++;
        return HttpResponse.json([], { headers: limits(0) });
      }),
    );
    const github = new TokenGitHubGateway({ missingEnv: [], now: () => (RESET - 60) * 1000 });
    expect(await github.listOpenPullRequests(REPO)).toEqual([]);
    await expect(github.listOpenPullRequests(REPO)).rejects.toMatchObject({
      code: 'github_rate_limited',
    });
    expect(calls).toBe(1);
  });

  test('a secondary limit waits out retry-after', async () => {
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, () =>
        HttpResponse.json(
          { message: 'secondary rate limit' },
          { status: 403, headers: { 'retry-after': '120' } },
        ),
      ),
    );
    const now = 1_800_000_000_000;
    const github = new TokenGitHubGateway({ token: 'pat', missingEnv: [], now: () => now });
    await expect(github.listOpenPullRequests(REPO)).rejects.toMatchObject({
      code: 'github_rate_limited',
      params: { resetAt: new Date(now + 120_000).toISOString() },
    });
  });

  test('a 403 that is no rate limit is GitHub error as it is', async () => {
    server.use(
      http.get(`${API}/repos/${REPO}/pulls`, () =>
        HttpResponse.json({ message: 'Resource not accessible' }, { status: 403 }),
      ),
    );
    const github = new TokenGitHubGateway({ token: 'pat', missingEnv: [] });
    await expect(github.listOpenPullRequests(REPO)).rejects.toMatchObject({ status: 403 });
  });
});

describe('toRawPullRequest', () => {
  test('turns a snapshot back into the payload shape, losslessly', () => {
    for (const name of ['pull_request.opened', 'pull_request.closed'] as const) {
      const pr = fixturePullRequest(name);
      expect(toPullRequest(toRawPullRequest(pr))).toEqual(pr);
    }
    const fork = fixturePullRequest('pull_request.opened-fork');
    expect(toPullRequest(toRawPullRequest(fork))).toEqual(fork);
  });
});
