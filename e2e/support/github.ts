// Webhook deliveries for the specs: a GitHub fixture as PR `number`, signed like GitHub.
import { expect, type APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { STATE_FILE, type StackState } from './env.ts';

export const stackState = (): StackState =>
  JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;

/** The GitHub login of the fixtures' PR author. */
export const AUTHOR_LOGIN = 'wb-dev';

type Fixture = 'ready_for_review' | 'opened-draft';

type Repo = { full_name: string; name: string; owner: { login: string } };
type Payload = {
  number: number;
  repository: Repo;
  installation?: { id: number };
  pull_request: {
    number: number;
    title: string;
    head: { sha: string; repo: Repo };
    base: { sha: string; repo: Repo };
  };
};

/**
 * Posts the `pull_request.<fixture>` payload as PR `number` at the fixture repository's shas;
 * `repository` moves it to another repository (and App installation) than the fixture's.
 */
export async function deliverPullRequest(
  request: APIRequestContext,
  fixture: Fixture,
  number: number,
  title: string,
  repository?: { fullName: string; installationId: number },
): Promise<void> {
  const { apiUrl, webhookSecret, baseSha, headSha } = stackState();
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
  if (repository) {
    const [owner = '', name = ''] = repository.fullName.split('/');
    for (const repo of [
      payload.repository,
      payload.pull_request.head.repo,
      payload.pull_request.base.repo,
    ]) {
      Object.assign(repo, {
        full_name: repository.fullName,
        name,
        owner: { ...repo.owner, login: owner },
      });
    }
    payload.installation = { id: repository.installationId };
  }
  const body = JSON.stringify(payload);

  const response = await request.post(`${apiUrl}/webhooks/github`, {
    data: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'pull_request',
      'x-github-delivery': randomUUID(),
      'x-hub-signature-256': `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`,
    },
  });
  expect(response.status()).toBe(202);
}
