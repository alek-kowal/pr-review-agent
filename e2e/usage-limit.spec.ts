// P-25: agents on a Claude subscription. A review session that hits the usage limit pauses the
// round until just after the reset ("Paused until <time>: Claude usage limit"); then the same
// attempt goes on by itself. The hold stops every run, so the spec runs alone in its own
// Playwright project (after pause-budget, before the rest) and lifts the hold when it ends.
// The shared stack runs without a model mode; the spec answers `/api/status` as a subscription.
import { expect, test } from '@playwright/test';
import { bannerTitle, onPrPage, sql, WB_SLUG } from './support/api.ts';
import { USAGE_LIMIT_PRS } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

/** The review attempts of PR `number`'s round. */
async function reviewAttempts(number: number) {
  return sql<{ attempt: number; status: string; error_code: string | null }>(
    `select e.attempt, e.status, e.error_code from stage_executions e
       join runs r on r.id = e.run_id
       join pull_requests p on p.id = r.pull_request_id
       join repositories repo on repo.id = p.repository_id
     where repo.slug = $1 and p.number = $2 and e.stage = 'review'
     order by e.attempt`,
    [WB_SLUG, number],
  );
}

const PAUSED = /^Paused until (\d{1,2} \w{3}, )?\d{2}:\d{2}: Claude usage limit$/;

test('a usage limit pauses the round until the reset, then the same attempt goes on', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const number = USAGE_LIMIT_PRS.from + testInfo.retry;
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const json = { ...(await response.json()), modelAuth: 'subscription' };
    await route.fulfill({ response, json });
  });

  try {
    await page.goto('/prs');
    await page.getByRole('button', { name: /^Factory status:/ }).click();
    await expect(page.getByRole('group', { name: 'Factory status' })).toContainText(
      'Claude subscription',
    );

    await deliverPullRequest(request, 'ready_for_review', number, `Usage limit ${number}`);
    await onPrPage(page, number, async () => {
      await expect(bannerTitle(page)).toHaveText(PAUSED, { timeout: 5_000 });
    });
    expect(await reviewAttempts(number)).toEqual([
      { attempt: 1, status: 'pending', error_code: 'usage_limit_reached' },
    ]);
    await page.goto('/activity');
    const table = page.getByRole('table', { name: 'In progress' });
    await expect(table.getByText(PAUSED)).toBeVisible();
    await expect(table).toContainText('API-equivalent');

    // Just after the reset the drainer lets the parked review go on, as the same attempt.
    await expect(async () => {
      await page.goto(`/pr/${WB_SLUG}/${number}`);
      await expect(bannerTitle(page)).toHaveText(/^Decide \d+ findings/, { timeout: 5_000 });
    }).toPass({ timeout: 150_000 });
    expect(await reviewAttempts(number)).toEqual([
      { attempt: 1, status: 'succeeded', error_code: null },
    ]);
  } finally {
    // Never leave a hold behind for the specs that follow.
    await sql(`update usage_limit_holds set until = now() where until > now()`, []);
  }
});
