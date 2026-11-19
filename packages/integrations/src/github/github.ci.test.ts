// S-04-T3: `getCiStatus` maps check runs and the combined commit status to counts.
import { generateKeyPairSync } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { checkRunState, commitStatusState } from './github-gateway.ts';
import { OctokitGitHubGateway } from './octokit-github-gateway.ts';

const API = 'https://api.github.com';
const REPO = 'acme/ci-repo';
const SHA = 'a'.repeat(40);
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
        { token: 'ghs_ci', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      ),
    ),
  );
}

const checkRun = (name: string, status: string, conclusion: string | null) => ({
  id: name.length,
  name,
  status,
  conclusion,
});

describe('getCiStatus', () => {
  test('counts check runs and commit statuses as passed, failed and pending', async () => {
    serveInstallation();
    const requests: string[] = [];
    server.use(
      http.get(`${API}/repos/:owner/:repo/commits/:ref/check-runs`, ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({
          total_count: 5,
          check_runs: [
            checkRun('build', 'completed', 'success'),
            checkRun('lint', 'completed', 'failure'),
            checkRun('e2e', 'in_progress', null),
            checkRun('docs', 'completed', 'skipped'),
            checkRun('deploy-preview', 'completed', 'timed_out'),
          ],
        });
      }),
      http.get(`${API}/repos/:owner/:repo/commits/:ref/status`, ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({
          state: 'failure',
          statuses: [
            { context: 'ci/legacy', state: 'success' },
            { context: 'coverage', state: 'error' },
            { context: 'license', state: 'pending' },
          ],
        });
      }),
    );

    const status = await gateway().getCiStatus(REPO, SHA);

    expect(status).toMatchObject({ passed: 3, failed: 3, pending: 2, total: 8 });
    expect(status.checks).toContainEqual({ name: 'lint', source: 'check_run', state: 'failed' });
    expect(status.checks).toContainEqual({ name: 'coverage', source: 'status', state: 'failed' });
    expect(requests[0]).toContain(`/repos/${REPO}/commits/${SHA}/check-runs`);
    expect(requests[1]).toContain(`/repos/${REPO}/commits/${SHA}/status`);
  });

  test('reads every page of check runs', async () => {
    serveInstallation();
    const pages: string[] = [];
    server.use(
      http.get(`${API}/repos/:owner/:repo/commits/:ref/check-runs`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        pages.push(String(page));
        const count = page === 1 ? 100 : 20;
        return HttpResponse.json({
          total_count: 120,
          check_runs: Array.from({ length: count }, (_, i) =>
            checkRun(`job-${page}-${i}`, 'completed', 'success'),
          ),
        });
      }),
      http.get(`${API}/repos/:owner/:repo/commits/:ref/status`, () =>
        HttpResponse.json({ state: 'pending', statuses: [] }),
      ),
    );

    const status = await gateway().getCiStatus(REPO, SHA);

    expect(pages).toEqual(['1', '2']);
    expect(status).toMatchObject({ passed: 120, failed: 0, pending: 0, total: 120 });
  });

  test('a commit without CI has no checks', async () => {
    serveInstallation();
    server.use(
      http.get(`${API}/repos/:owner/:repo/commits/:ref/check-runs`, () =>
        HttpResponse.json({ total_count: 0, check_runs: [] }),
      ),
      http.get(`${API}/repos/:owner/:repo/commits/:ref/status`, () =>
        HttpResponse.json({ state: 'pending', statuses: [] }),
      ),
    );

    expect(await gateway().getCiStatus(REPO, SHA)).toEqual({
      passed: 0,
      failed: 0,
      pending: 0,
      total: 0,
      checks: [],
    });
  });

  test('a GitHub error is thrown with its status', async () => {
    serveInstallation();
    server.use(
      http.get(`${API}/repos/:owner/:repo/commits/:ref/check-runs`, () =>
        HttpResponse.json({ message: 'Server Error' }, { status: 502 }),
      ),
    );

    await expect(gateway().getCiStatus(REPO, SHA)).rejects.toMatchObject({ status: 502 });
  });
});

describe('state mapping', () => {
  test.each([
    [{ status: 'queued', conclusion: null }, 'pending'],
    [{ status: 'completed', conclusion: 'neutral' }, 'passed'],
    [{ status: 'completed', conclusion: 'cancelled' }, 'failed'],
    [{ status: 'completed', conclusion: 'action_required' }, 'failed'],
    [{ status: 'completed', conclusion: 'stale' }, 'pending'],
  ] as const)('check run %o is %s', (run, state) => {
    expect(checkRunState(run)).toBe(state);
  });

  test.each([
    ['success', 'passed'],
    ['failure', 'failed'],
    ['error', 'failed'],
    ['pending', 'pending'],
  ] as const)('commit status %s is %s', (raw, state) => {
    expect(commitStatusState(raw)).toBe(state);
  });
});
