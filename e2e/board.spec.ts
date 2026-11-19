// S-02-T10: the board's lanes come from the core state table.
import { expect, test } from '@playwright/test';
import { deliverPullRequest } from './support/github.ts';

test('a reviewed PR waits in Action needed and a draft in Not reviewed', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  // A retry uses new PRs, so it never sees the first attempt's rounds.
  const number = 320 + testInfo.retry;
  const draft = 325 + testInfo.retry;
  const title = `Board: edge labels ${number}`;
  const draftTitle = `Board: draft grouping ${draft}`;
  await deliverPullRequest(request, 'ready_for_review', number, title);
  await deliverPullRequest(request, 'opened-draft', draft, draftTitle);

  const actionNeeded = page.locator('[data-lane="action_needed"]');
  const card = actionNeeded
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title }) });
  // The board polls; reloading also covers the moment before the worker stored the PR.
  await expect(async () => {
    await page.goto('/prs');
    await expect(card).toContainText('Decide 3 findings', { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const notReviewed = page.locator('[data-lane="not_reviewed"]');
  await expect(notReviewed.getByRole('link', { name: draftTitle })).toBeVisible();
  await expect(actionNeeded.getByRole('link', { name: draftTitle })).toHaveCount(0);
});
