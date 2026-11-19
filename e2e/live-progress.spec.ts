// S-03-T13: live progress end to end. A signed ready_for_review webhook starts round 1 with a
// held reviewer (e2e/support/stack.ts): it reports one turn, then waits for this spec to release
// it. Every check after the first page load follows live updates; no page is reloaded.
import { expect, test } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import { HELD_PRS, releaseFile } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

test('a round shows live on the board, the PR page, Activity, Run detail and the Timeline', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  // A retry uses a new PR, so it never sees the first attempt's round.
  const number = HELD_PRS.from + testInfo.retry;
  const title = `Live: edge label editing ${number}`;
  const release = releaseFile(number);
  await rm(release, { force: true });

  try {
    // The board is open before the webhook arrives; the card shows up through /api/live (OQ18).
    await page.goto('/prs');
    await expect(page.locator('[data-lane="agents_working"]')).toBeVisible();
    const postedAt = Date.now();
    await deliverPullRequest(request, 'ready_for_review', number, title);
    const working = page.locator('[data-lane="agents_working"]');
    await expect(working.getByRole('link', { name: title })).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - postedAt).toBeLessThan(10_000);

    // Activity: the run reaches Review and its first turn's cost.
    await page.getByRole('link', { name: 'Activity' }).first().click();
    const row = page
      .getByRole('table', { name: 'In progress' })
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: title }) });
    await expect(row.getByTestId('run-stage')).toHaveText('Review', { timeout: 30_000 });
    await expect(row.getByTestId('run-cost')).toHaveText('$0.12');
    await expect(row.getByRole('link', { name: 'Round 1 of 3' })).toBeVisible();

    // PR page: the full stepper while the round runs, Review current, cost so far.
    await row.getByRole('link', { name: title }).click();
    await expect(page).toHaveURL(new RegExp(`/pr/workflowbuilder/${number}$`));
    const stepper = page.getByTestId('stepper');
    await expect(stepper.locator('[data-step="review"]')).toHaveAttribute('data-status', 'running');
    await expect(page.getByTestId('round-line')).toContainText('running · $0.12 so far');

    // The reviewer answers: the stepper folds into the round line and the findings appear.
    await writeFile(release, '');
    await expect(page.getByTestId('round-line')).toContainText(/finished \d\d:\d\d · \$0\.31/, {
      timeout: 30_000,
    });
    await expect(stepper).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stages' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible();

    // Run detail from the round line.
    await page.getByRole('link', { name: 'Run details' }).click();
    await expect(page.getByRole('heading', { name: `Round 1 of 3 on #${number}` })).toBeVisible();
    await expect(page.getByTestId('run-cost')).toContainText('$0.31');

    // Timeline: who acted and the finished round's cost, linking back to Run detail.
    await page.getByRole('link', { name: new RegExp(`#${number} ${title}`) }).click();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    const entries = page.getByRole('list', { name: 'Timeline entries' });
    const finished = entries.locator('[data-entry="run_finished"]');
    await expect(finished).toContainText('Round 1 finished');
    await expect(finished.getByTestId('entry-actor')).toHaveText('PR Review Agent');
    await expect(finished.getByTestId('entry-cost')).toHaveText('$0.31');
    await expect(finished.getByRole('link', { name: 'Run details' })).toBeVisible();
    const ready = entries.locator('[data-entry="pr_ready"]');
    await expect(ready.getByTestId('entry-actor')).toHaveText('By hand');

    // Activity no longer lists the finished run.
    await page.getByRole('link', { name: 'Activity' }).first().click();
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  } finally {
    await rm(release, { force: true });
  }
});
