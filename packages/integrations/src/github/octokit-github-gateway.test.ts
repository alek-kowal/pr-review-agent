import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { IntegrationNotConfiguredError } from '../errors.ts';
import { githubFixture, signWebhook } from '../testing/index.ts';
import {
  createGitHubGateway,
  OctokitGitHubGateway,
  UnconfiguredGitHubGateway,
} from './octokit-github-gateway.ts';

const API = 'https://api.github.com';
const REPO = 'synergycodes/workflowbuilder';
const INSTALLATION = 55500001;
const SECRET = 'webhook-secret-for-tests';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Serves the installation lookup and counts token requests; each token lives one hour. */
function serveApp(clock: { now: number }) {
  const tokenRequests: string[] = [];
  server.use(
    http.get(`${API}/repos/:owner/:repo/installation`, ({ params }) =>
      `${params.owner}/${params.repo}` === REPO
        ? HttpResponse.json({ id: INSTALLATION })
        : HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    ),
    http.post(`${API}/app/installations/:id/access_tokens`, ({ request }) => {
      tokenRequests.push(request.headers.get('authorization') ?? '');
      return HttpResponse.json(
        {
          token: `ghs_token_${tokenRequests.length}`,
          expires_at: new Date(clock.now + 3_600_000).toISOString(),
        },
        { status: 201 },
      );
    }),
  );
  return tokenRequests;
}

function gateway(clock = { now: Date.now() }) {
  return new OctokitGitHubGateway({
    appId: '1000001',
    privateKey,
    webhookSecret: SECRET,
    now: () => clock.now,
  });
}

describe('installation tokens', () => {
  test('a token is reused until shortly before it expires, then replaced', async () => {
    const clock = { now: Date.now() };
    const tokenRequests = serveApp(clock);
    const github = gateway(clock);

    const first = await github.getInstallationToken(INSTALLATION);
    const second = await github.getInstallationToken(INSTALLATION);
    expect(second.token).toBe(first.token);
    expect(tokenRequests).toHaveLength(1);
    // Requested with the App's JWT, not with a token.
    expect(tokenRequests[0]).toMatch(/^bearer /i);

    clock.now += 59 * 60_000 + 1;
    const third = await github.getInstallationToken(INSTALLATION);
    expect(third.token).not.toBe(first.token);
    expect(tokenRequests).toHaveLength(2);
  });

  test('two calls at once share one request', async () => {
    const tokenRequests = serveApp({ now: Date.now() });
    const github = gateway();

    const [a, b] = await Promise.all([
      github.getInstallationToken(INSTALLATION),
      github.getInstallationToken(INSTALLATION),
    ]);

    expect(a.token).toBe(b.token);
    expect(tokenRequests).toHaveLength(1);
  });
});

describe('repository calls', () => {
  test('postIssueComment sends the exact body with the installation token', async () => {
    serveApp({ now: Date.now() });
    const posted: Array<{ url: string; auth: string | null; json: unknown }> = [];
    server.use(
      http.post(`${API}/repos/:owner/:repo/issues/:number/comments`, async ({ request }) => {
        posted.push({
          url: request.url,
          auth: request.headers.get('authorization'),
          json: await request.json(),
        });
        return HttpResponse.json({ id: 9001 }, { status: 201 });
      }),
    );
    const body = 'Ready for team member review (round 1)';

    const result = await gateway().postIssueComment(REPO, 312, body);

    expect(result).toEqual({ id: 9001 });
    expect(posted).toEqual([
      {
        url: `${API}/repos/${REPO}/issues/312/comments`,
        auth: 'token ghs_token_1',
        json: { body },
      },
    ]);
  });

  test('getPullRequest maps the REST pull request to the snapshot', async () => {
    serveApp({ now: Date.now() });
    const raw = githubFixture('pull_request.opened-fork').payload.pull_request as Record<
      string,
      unknown
    >;
    server.use(http.get(`${API}/repos/:owner/:repo/pulls/:number`, () => HttpResponse.json(raw)));

    const pr = await gateway().getPullRequest(REPO, 313);

    expect(pr).toMatchObject({
      fullName: REPO,
      number: 313,
      headRepoFullName: 'outside-dev/workflowbuilder',
      isFork: true,
      isDraft: false,
      state: 'open',
      commitsCount: 2,
      authorLogin: 'outside-dev',
    });
  });

  test('after the App is reinstalled, a stale cached installation is looked up again once', async () => {
    let installation = INSTALLATION;
    const tokens = new Map<string, number>();
    const posted: Array<string | null> = [];
    server.use(
      http.get(`${API}/repos/:owner/:repo/installation`, () =>
        HttpResponse.json({ id: installation }),
      ),
      http.post(`${API}/app/installations/:id/access_tokens`, ({ params }) => {
        if (Number(params.id) !== installation) {
          return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
        }
        const token = `ghs_installation_${installation}`;
        tokens.set(token, installation);
        const expires_at = new Date(Date.now() + 3_600_000).toISOString();
        return HttpResponse.json({ token, expires_at }, { status: 201 });
      }),
      http.post(`${API}/repos/:owner/:repo/issues/:number/comments`, ({ request }) => {
        const auth = request.headers.get('authorization');
        posted.push(auth);
        // Tokens of a removed installation are revoked.
        const revoked = tokens.get(auth?.replace(/^token /, '') ?? '') !== installation;
        return revoked
          ? HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
          : HttpResponse.json({ id: posted.length }, { status: 201 });
      }),
    );
    const github = gateway();
    await github.postIssueComment(REPO, 1, 'before');

    installation = INSTALLATION + 1;
    const result = await github.postIssueComment(REPO, 1, 'after');

    expect(result).toEqual({ id: 3 });
    expect(posted).toEqual([
      `token ghs_installation_${INSTALLATION}`,
      `token ghs_installation_${INSTALLATION}`,
      `token ghs_installation_${INSTALLATION + 1}`,
    ]);
  });

  test('a lasting 404 is not retried twice', async () => {
    serveApp({ now: Date.now() });
    let requests = 0;
    server.use(
      http.get(`${API}/repos/:owner/:repo/pulls/:number`, () => {
        requests += 1;
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }),
    );
    const github = gateway();
    await github.getRepoInstallationId(REPO);

    await expect(github.getPullRequest(REPO, 404)).rejects.toMatchObject({ status: 404 });
    expect(requests).toBe(2);
  });

  test('a repository without the App has no installation id, and its calls say so', async () => {
    serveApp({ now: Date.now() });
    const github = gateway();

    expect(await github.getRepoInstallationId('someone/else')).toBeNull();
    await expect(github.postIssueComment('someone/else', 1, 'x')).rejects.toMatchObject({
      code: 'github_app_not_installed',
      params: { fullName: 'someone/else' },
    });
  });
});

describe('listAccessibleRepositories', () => {
  test('lists every installation’s repositories with that installation’s token, sorted', async () => {
    const tokens = serveApp({ now: Date.now() });
    const seen: string[] = [];
    const repo = (fullName: string, extra: Record<string, unknown> = {}) => ({
      full_name: fullName,
      default_branch: 'main',
      private: false,
      ...extra,
    });
    server.use(
      http.get(`${API}/app/installations`, () =>
        HttpResponse.json([
          { id: INSTALLATION, account: { login: 'synergycodes' } },
          { id: 2, account: { login: 'acme' } },
        ]),
      ),
      http.get(`${API}/installation/repositories`, ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        seen.push(auth);
        // Tokens are handed out in installation order: the first is the WB installation's.
        const first = auth.endsWith('ghs_token_1');
        return HttpResponse.json({
          total_count: first ? 1 : 2,
          repositories: first
            ? [repo(REPO, { default_branch: 'develop' })]
            : [repo('acme/second-repo', { private: true }), repo('acme/another')],
        });
      }),
    );

    const repositories = await gateway().listAccessibleRepositories();

    expect(repositories).toEqual([
      {
        fullName: 'acme/another',
        installationId: 2,
        account: 'acme',
        defaultBranch: 'main',
        private: false,
      },
      {
        fullName: 'acme/second-repo',
        installationId: 2,
        account: 'acme',
        defaultBranch: 'main',
        private: true,
      },
      {
        fullName: REPO,
        installationId: INSTALLATION,
        account: 'synergycodes',
        defaultBranch: 'develop',
        private: false,
      },
    ]);
    expect(tokens).toHaveLength(2);
    expect(seen).toEqual(['token ghs_token_1', 'token ghs_token_2']);
  });
});

describe('webhook signatures', () => {
  const { body } = githubFixture('pull_request.ready_for_review');

  test('a body signed with the secret passes', async () => {
    expect(await gateway().verifyWebhook(body, signWebhook(body, SECRET))).toBe(true);
    expect(
      await gateway().verifyWebhook(new TextEncoder().encode(body), signWebhook(body, SECRET)),
    ).toBe(true);
  });

  test('a bad, foreign or missing signature fails', async () => {
    const github = gateway();
    expect(await github.verifyWebhook(body, signWebhook(body, 'another-secret'))).toBe(false);
    expect(await github.verifyWebhook(`${body} `, signWebhook(body, SECRET))).toBe(false);
    expect(await github.verifyWebhook(body, 'sha256=nothex')).toBe(false);
    expect(await github.verifyWebhook(body, undefined)).toBe(false);
  });
});

describe('createGitHubGateway', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pra-github-'));
    await writeFile(path.join(dir, 'app.pem'), privateKey);
    await writeFile(path.join(dir, 'empty.pem'), '\n');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test('missing env gives github_not_configured on every call, with no request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const github = createGitHubGateway({});

    const calls = [
      github.verifyWebhook('{}', 'sha256=00'),
      github.getRepoInstallationId(REPO),
      github.getInstallationToken(INSTALLATION),
      github.getPullRequest(REPO, 1),
      github.postIssueComment(REPO, 1, 'hello'),
    ];

    for (const call of calls) {
      const error = await call.then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
      expect(error).toMatchObject({
        code: 'github_not_configured',
        params: {
          missing: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY_PATH', 'GITHUB_WEBHOOK_SECRET'],
        },
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('a missing or empty key file counts as not configured', () => {
    const env = { GITHUB_APP_ID: '1', GITHUB_WEBHOOK_SECRET: 's' };
    for (const key of ['missing.pem', 'empty.pem']) {
      const github = createGitHubGateway({
        ...env,
        GITHUB_APP_PRIVATE_KEY_PATH: path.join(dir, key),
      });
      expect(github).toBeInstanceOf(UnconfiguredGitHubGateway);
      expect((github as UnconfiguredGitHubGateway).missing).toEqual([
        'GITHUB_APP_PRIVATE_KEY_PATH',
      ]);
    }
  });

  test('all three set gives the Octokit gateway', () => {
    const github = createGitHubGateway({
      GITHUB_APP_ID: '1000001',
      GITHUB_APP_PRIVATE_KEY_PATH: path.join(dir, 'app.pem'),
      GITHUB_WEBHOOK_SECRET: SECRET,
    });
    expect(github).toBeInstanceOf(OctokitGitHubGateway);
  });
});
