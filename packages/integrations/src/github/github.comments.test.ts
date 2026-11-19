// S-23-T3: what people wrote on a PR, the analyst's input: line comments, conversation comments
// and review bodies, oldest first, without bots.
import { generateKeyPairSync } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { FakeGitHubGateway } from '../testing/github.ts';
import { OctokitGitHubGateway } from './octokit-github-gateway.ts';

const API = 'https://api.github.com';
const REPO = 'acme/learning-repo';
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const user = (login: string, type = 'User') => ({ login, type });

test('reads line comments, conversation comments and review bodies, oldest first, no bots', async () => {
  server.use(
    http.get(`${API}/repos/:owner/:repo/installation`, () => HttpResponse.json({ id: 77 })),
    http.post(`${API}/app/installations/:id/access_tokens`, () =>
      HttpResponse.json(
        { token: 'ghs_x', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      ),
    ),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/comments`, () =>
      HttpResponse.json([
        {
          id: 11,
          user: user('tomek'),
          body: 'Generate this table.',
          path: 'README.md',
          line: 12,
          created_at: '2026-11-02T10:00:00Z',
        },
      ]),
    ),
    http.get(`${API}/repos/:owner/:repo/issues/:number/comments`, () =>
      HttpResponse.json([
        { id: 21, user: user('kasia'), body: 'Done.', created_at: '2026-11-03T10:00:00Z' },
        {
          id: 22,
          user: user('pr-review-agent[bot]', 'Bot'),
          body: 'Round 1',
          created_at: '2026-11-01T10:00:00Z',
        },
      ]),
    ),
    http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews`, () =>
      HttpResponse.json([
        { id: 31, user: user('ola'), body: 'Looks fine.', submitted_at: '2026-11-01T09:00:00Z' },
        { id: 32, user: user('ola'), body: '', submitted_at: '2026-11-04T09:00:00Z' },
      ]),
    ),
  );

  const gateway = new OctokitGitHubGateway({
    appId: '1000001',
    privateKey,
    webhookSecret: 'secret',
  });
  const comments = await gateway.listReviewComments(REPO, 278);
  expect(comments.map((c) => [c.id, c.author, c.path, c.line])).toEqual([
    ['review:31', 'ola', null, null],
    ['review_comment:11', 'tomek', 'README.md', 12],
    ['issue_comment:21', 'kasia', null, null],
  ]);
});

test('the fake serves the comments it was given', async () => {
  const fake = new FakeGitHubGateway()
    .addComment(REPO, 278, 'tomek', 'Generate this table.', { path: 'README.md', line: 12 })
    .addComment(REPO, 278, 'kasia', 'Done.');
  const comments = await fake.listReviewComments(REPO, 278);
  expect(comments.map((c) => [c.author, c.body, c.path])).toEqual([
    ['tomek', 'Generate this table.', 'README.md'],
    ['kasia', 'Done.', null],
  ]);
  expect(await fake.listReviewComments(REPO, 279)).toEqual([]);
});
