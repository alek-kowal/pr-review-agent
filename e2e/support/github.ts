// Webhook deliveries for the specs: a GitHub fixture as PR `number`, signed like GitHub.
import { expect, type APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { STATE_FILE, type StackState } from './env.ts';

export const stackState = (): StackState =>
  JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;

/** The GitHub login of the fixtures' PR author. */
export const AUTHOR_LOGIN = 'wb-dev';

type Fixture = 'ready_for_review' | 'opened-draft' | 'synchronize' | 'closed';

type Repo = { full_name: string; name: string; owner: { login: string } };
type Payload = {
  number: number;
  before?: string;
  after?: string;
  repository: Repo;
  installation?: { id: number };
  pull_request: {
    number: number;
    title: string;
    commits: number;
    updated_at: string;
    user: { login: string };
    head: { sha: string; ref: string; repo: Repo };
    base: { sha: string; repo: Repo };
  };
};

/** The commit count of the ready and draft fixtures: a push adds to it. */
export const FIXTURE_COMMITS = 2;

/**
 * Posts the `pull_request.<fixture>` payload as PR `number` at the fixture repository's shas;
 * `repository` moves it to another repository (and App installation) than the fixture's, and
 * `branch` replaces the fixture's head branch name (`feature/edge-labels`); `author` replaces
 * the PR author's GitHub login (`AUTHOR_LOGIN`).
 */
export async function deliverPullRequest(
  request: APIRequestContext,
  fixture: Fixture,
  number: number,
  title: string,
  repository?: Repository,
  push?: { headSha: string; commits: number },
  branch?: string,
  author?: string,
): Promise<void> {
  const { baseSha, headSha } = stackState();
  const file = new URL(
    `../../packages/integrations/src/testing/fixtures/github/pull_request.${fixture}.json`,
    import.meta.url,
  );
  const payload = JSON.parse(readFileSync(file, 'utf8')) as Payload;
  payload.number = number;
  payload.pull_request.number = number;
  payload.pull_request.title = title;
  payload.pull_request.head.sha = headSha;
  payload.pull_request.base.sha = baseSha;
  if (branch) payload.pull_request.head.ref = branch;
  if (author) payload.pull_request.user.login = author;
  if (push) {
    payload.before = payload.pull_request.head.sha;
    payload.after = push.headSha;
    payload.pull_request.head.sha = push.headSha;
    payload.pull_request.commits = push.commits;
    // Later than any fixture snapshot, so the worker never takes the push for a late delivery.
    payload.pull_request.updated_at = new Date().toISOString();
  }
  if (repository) {
    moveTo(
      repository,
      [payload.repository, payload.pull_request.head.repo, payload.pull_request.base.repo],
      payload,
    );
  }
  await deliver(request, 'pull_request', payload);
}

type Repository = { fullName: string; installationId: number };

/** Points the payload's repositories and App installation at `repository`. */
function moveTo(repository: Repository, repos: Repo[], payload: { installation?: { id: number } }) {
  const [owner = '', name = ''] = repository.fullName.split('/');
  for (const repo of repos) {
    Object.assign(repo, {
      full_name: repository.fullName,
      name,
      owner: { ...repo.owner, login: owner },
    });
  }
  payload.installation = { id: repository.installationId };
}

/** Posts `payload` as GitHub's `event`, signed with the stack's webhook secret. */
async function deliver(request: APIRequestContext, event: string, payload: unknown): Promise<void> {
  const { apiUrl, webhookSecret } = stackState();
  const body = JSON.stringify(payload);
  const response = await request.post(`${apiUrl}/webhooks/github`, {
    data: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': randomUUID(),
      'x-hub-signature-256': `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`,
    },
  });
  expect(response.status()).toBe(202);
}

/** Posts `pull_request.synchronize` for PR `number`: the branch now ends at `headSha`. */
export async function deliverPush(
  request: APIRequestContext,
  number: number,
  title: string,
  push: { headSha: string; commits: number },
  repository?: Repository,
): Promise<void> {
  await deliverPullRequest(request, 'synchronize', number, title, repository, push);
}

/**
 * Posts `check_suite.completed` at `headSha` in `repository`: GitHub's CI finished there, and the
 * worker reads the commit's checks again.
 */
export async function deliverCheckSuite(
  request: APIRequestContext,
  repository: Repository,
  headSha: string,
): Promise<void> {
  const file = new URL(
    '../../packages/integrations/src/testing/fixtures/github/check_suite.completed.json',
    import.meta.url,
  );
  const payload = JSON.parse(readFileSync(file, 'utf8')) as {
    check_suite: { head_sha: string; conclusion: string };
    repository: Repo;
    installation?: { id: number };
  };
  payload.check_suite.head_sha = headSha;
  payload.check_suite.conclusion = 'success';
  moveTo(repository, [payload.repository], payload);
  await deliver(request, 'check_suite', payload);
}
