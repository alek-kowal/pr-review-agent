// S-12-T1: the squash merge pinned to the reviewed SHA, and the fresh PR state and reviews the
// merge re-checks.
import { generateKeyPairSync } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { FakeGitHubGateway, fixturePullRequest } from '../testing/github.ts';
import { changesRequestedBy } from './github-gateway.ts';
import { OctokitGitHubGateway } from './octokit-github-gateway.ts';

const API = 'https://api.github.com';
const REPO = 'acme/merge-repo';
const SHA = 'b'.repeat(40);
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const gateway = () =>
  new OctokitGitHubGateway({ appId: '1000001', privateKey, webhookSecret: 'secret' });

function serveInstallation() {
  server.use(
    http.get(`${API}/repos/:owner/:repo/installation`, () => HttpResponse.json({ id: 77 })),
    http.post(`${API}/app/installations/:id/access_tokens`, () =>
      HttpResponse.json(
        { token: 'ghs_merge', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      ),
    ),
  );
}

const MERGE = { fullName: REPO, number: 7, sha: SHA, title: 'Edge labels (#7)', message: 'm' };

describe('squashMerge', () => {
  test('sends a squash merge pinned to the sha, with title and message', async () => {
    serveInstallation();
    let body: Record<string, unknown> = {};
    let path = '';
    server.use(
      http.put(`${API}/repos/:owner/:repo/pulls/:number/merge`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ sha: 'c'.repeat(40), merged: true, message: 'merged' });
      }),
    );

    await expect(
      gateway().squashMerge({ ...MERGE, message: 'Body\n\nSigned-off-in-app-by: Kasia' }),
    ).resolves.toEqual({ merged: true, sha: 'c'.repeat(40) });
    expect(path).toBe('/repos/acme/merge-repo/pulls/7/merge');
    expect(body).toEqual({
      merge_method: 'squash',
      sha: SHA,
      commit_title: 'Edge labels (#7)',
      commit_message: 'Body\n\nSigned-off-in-app-by: Kasia',
    });
  });

  test('a 405 for a required status check is a refusal with GitHub message', async () => {
    serveInstallation();
    const message = 'Required status check "build" is expected.';
    server.use(
      http.put(`${API}/repos/:owner/:repo/pulls/:number/merge`, () =>
        HttpResponse.json({ message }, { status: 405 }),
      ),
    );

    await expect(gateway().squashMerge(MERGE)).resolves.toEqual({
      merged: false,
      status: 405,
      message,
    });
  });

  test('a head that moved (409) is a refusal; a server error throws', async () => {
    serveInstallation();
    server.use(
      http.put(`${API}/repos/:owner/:repo/pulls/:number/merge`, () =>
        HttpResponse.json({ message: 'Head branch was modified.' }, { status: 409 }),
      ),
    );
    await expect(gateway().squashMerge(MERGE)).resolves.toMatchObject({
      merged: false,
      status: 409,
    });

    server.use(
      http.put(`${API}/repos/:owner/:repo/pulls/:number/merge`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    await expect(gateway().squashMerge(MERGE)).rejects.toMatchObject({ status: 500 });
  });
});

describe('fresh state', () => {
  test('getPullRequestState reads the head, the state and the mergeable state', async () => {
    serveInstallation();
    const raw = JSON.parse(JSON.stringify(fixturePullRequestRaw()));
    server.use(
      http.get(`${API}/repos/:owner/:repo/pulls/:number`, () =>
        HttpResponse.json({ ...raw, mergeable_state: 'blocked' }),
      ),
    );

    await expect(gateway().getPullRequestState(REPO, 312)).resolves.toEqual({
      headSha: raw.head.sha,
      state: 'open',
      mergeableState: 'blocked',
    });
  });

  test('a later APPROVED from the same reviewer clears their changes request', async () => {
    serveInstallation();
    const review = (login: string, state: string) => ({ id: 1, user: { login }, state });
    server.use(
      http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews`, () =>
        HttpResponse.json([
          review('tomek', 'CHANGES_REQUESTED'),
          review('ola', 'CHANGES_REQUESTED'),
          review('tomek', 'COMMENTED'),
          review('ola', 'APPROVED'),
          review('ania', 'CHANGES_REQUESTED'),
        ]),
      ),
    );

    await expect(gateway().listChangesRequested(REPO, 7)).resolves.toEqual(['ania', 'tomek']);
  });

  test('a dismissal clears a request; a comment does not', () => {
    expect(
      changesRequestedBy([
        { login: 'a', state: 'CHANGES_REQUESTED' },
        { login: 'a', state: 'DISMISSED' },
        { login: 'b', state: 'CHANGES_REQUESTED' },
        { login: 'b', state: 'COMMENTED' },
      ]),
    ).toEqual(['b']);
  });
});

describe('the fake', () => {
  test('merges a known PR at its head, refuses as told, and keeps reviews', async () => {
    const pr = fixturePullRequest('pull_request.ready_for_review');
    const fake = new FakeGitHubGateway().addPullRequest(pr);

    await expect(
      fake.squashMerge({ ...MERGE, fullName: pr.fullName, number: pr.number, sha: 'other' }),
    ).resolves.toMatchObject({ merged: false, status: 409 });
    const merged = await fake.squashMerge({
      ...MERGE,
      fullName: pr.fullName,
      number: pr.number,
      sha: pr.headSha,
    });
    expect(merged).toMatchObject({ merged: true });
    await expect(fake.getPullRequestState(pr.fullName, pr.number)).resolves.toMatchObject({
      state: 'merged',
    });

    fake.refuseMerge(REPO, 9, { status: 405, message: 'At least 1 approving review is required.' });
    await expect(fake.squashMerge({ ...MERGE, number: 9 })).resolves.toEqual({
      merged: false,
      status: 405,
      message: 'At least 1 approving review is required.',
    });

    fake.addReview(REPO, 9, 'tomek', 'CHANGES_REQUESTED');
    await expect(fake.listChangesRequested(REPO, 9)).resolves.toEqual(['tomek']);
    await expect(fake.getPullRequestState(REPO, 404)).rejects.toMatchObject({ status: 404 });
  });
});

/** The raw `pull_request` object of the ready fixture, as the REST API returns it. */
function fixturePullRequestRaw() {
  const pr = fixturePullRequest('pull_request.ready_for_review');
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    html_url: pr.htmlUrl,
    state: 'open',
    draft: false,
    merged: false,
    created_at: pr.openedAt,
    updated_at: pr.updatedAt,
    user: { login: pr.authorLogin },
    head: { sha: pr.headSha, ref: pr.headRef, repo: { full_name: pr.fullName } },
    base: { sha: pr.baseSha, ref: pr.baseRef, repo: { full_name: pr.fullName } },
  };
}
