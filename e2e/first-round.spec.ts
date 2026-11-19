// S-01-T15: round 1 end to end with doubles. A signed `ready_for_review` delivery goes to the
// api, the worker runs the scripted reviewer in a real worktree, and the PR page shows the result.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { FAILING_PR_FROM, STATE_FILE, type StackState } from './support/env.ts';

const state = (): StackState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState;

const FIXTURE = new URL(
  '../packages/integrations/src/testing/fixtures/github/pull_request.ready_for_review.json',
  import.meta.url,
);

type Payload = {
  number: number;
  pull_request: {
    number: number;
    title: string;
    head: { sha: string };
    base: { sha: string };
  };
};

/** Posts the fixture as PR `number` at the fixture repository's shas, signed like GitHub. */
async function deliverReadyForReview(
  request: APIRequestContext,
  number: number,
  title: string,
): Promise<void> {
  const { apiUrl, webhookSecret, baseSha, headSha } = state();
  const payload = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Payload;
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

async function githubActionBodies(prNumber: number): Promise<string[]> {
  const client = new pg.Client({ connectionString: state().databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ body: string }>(
      `select a.body from github_actions a
         join pull_requests p on p.id = a.pull_request_id
        where p.number = $1 order by a.id`,
      [prNumber],
    );
    return rows.map((row) => row.body);
  } finally {
    await client.end();
  }
}

test('a PR marked ready gets round 1: findings on the PR page and one GitHub sentence', async ({
  page,
  request,
}, testInfo) => {
  // A retry uses a new PR, so it never sees the first attempt's round.
  const number = 312 + testInfo.retry;
  const title = `Add edge label editing ${number}`;
  await deliverReadyForReview(request, number, title);

  // The worker stores the PR a moment after the api answered; the list does not poll for it.
  await expect(async () => {
    await page.goto('/prs');
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/pr/workflowbuilder/${number}$`));

  const blocking = page.getByRole('region', { name: 'Blocking' });
  await expect(blocking).toBeVisible({ timeout: 30_000 });
  await expect(blocking.getByText('Empty label hides the edge')).toBeVisible();
  await expect(blocking.getByText('apps/demo/src/edges.ts:1')).toBeVisible();
  const worth = page.getByRole('region', { name: 'Worth fixing' });
  await expect(worth.getByText('SDK entry exports an internal type')).toBeVisible();
  await expect(worth.getByText('packages/sdk/src/index.ts:2')).toBeVisible();
  const nits = page.getByRole('region', { name: 'Nits' });
  await expect(nits.getByText('Rename helper name is vague')).toBeVisible();
  await expect(page.getByText('Unchecked (level 1)').first()).toBeVisible();

  await expect
    .poll(() => githubActionBodies(number), { timeout: 15_000 })
    .toEqual(['Ready for team member review (round 1)']);
});

test('a PR whose reviewer fails shows the failed-round line and posts nothing', async ({
  page,
  request,
}, testInfo) => {
  const number = FAILING_PR_FROM + testInfo.retry;
  const title = `Break the reviewer ${number}`;
  await deliverReadyForReview(request, number, title);

  const failedLine = page.getByText(
    "Round 1 failed at Review: the reviewer's answer was not valid",
  );
  await expect(async () => {
    await page.goto(`/pr/workflowbuilder/${number}`);
    await expect(failedLine).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  // The failed run ended before the page showed it; give a stray comment job time to show up.
  await page.waitForTimeout(1_500);
  expect(await githubActionBodies(number)).toEqual([]);
});
