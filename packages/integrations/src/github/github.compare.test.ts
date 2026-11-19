// S-07-T2: `compareCommits` reads GitHub's compare counts for two commits.
import { generateKeyPairSync } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { FakeGitHubGateway } from '../testing/github.ts';
import { OctokitGitHubGateway } from './octokit-github-gateway.ts';

const API = 'https://api.github.com';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('compareCommits asks GitHub for base...head and returns its counts', async () => {
  let url = '';
  server.use(
    http.get(`${API}/repos/:owner/:repo/installation`, () => HttpResponse.json({ id: 77 })),
    http.post(`${API}/app/installations/:id/access_tokens`, () =>
      HttpResponse.json(
        { token: 'ghs_cmp', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      ),
    ),
    http.get(`${API}/repos/:owner/:repo/compare/:basehead`, ({ request }) => {
      url = request.url;
      return HttpResponse.json({ status: 'ahead', ahead_by: 2, behind_by: 0, commits: [] });
    }),
  );
  const gateway = new OctokitGitHubGateway({ appId: '1', privateKey, webhookSecret: 's' });

  await expect(gateway.compareCommits('acme/cmp', 'abc', 'def')).resolves.toEqual({
    status: 'ahead',
    aheadBy: 2,
    behindBy: 0,
  });
  expect(new URL(url).pathname).toBe('/repos/acme/cmp/compare/abc...def');
});

test('the fake serves set comparisons and 404s unknown pairs', async () => {
  const fake = new FakeGitHubGateway().setComparison('acme/cmp', 'abc', 'def', 2);
  await expect(fake.compareCommits('acme/cmp', 'abc', 'def')).resolves.toMatchObject({
    aheadBy: 2,
  });
  await expect(fake.compareCommits('acme/cmp', 'abc', 'abc')).resolves.toMatchObject({
    status: 'identical',
  });
  await expect(fake.compareCommits('acme/cmp', 'abc', 'zzz')).rejects.toMatchObject({
    status: 404,
  });
});
