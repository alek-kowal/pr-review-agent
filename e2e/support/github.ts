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

type Payload = {
  number: number;
  pull_request: {
    number: number;
    title: string;
    head: { sha: string };
    base: { sha: string };
  };
};

/** Posts the `pull_request.<fixture>` payload as PR `number` at the fixture repository's shas. */
export async function deliverPullRequest(
  request: APIRequestContext,
  fixture: Fixture,
  number: number,
  title: string,
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
