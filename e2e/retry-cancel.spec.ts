// S-09-T7: retry and cancel end to end. A level-two round whose reviewer fails once is retried
// from Review and reuses the stages before it; held rounds (e2e/support/stack.ts) are cancelled
// from the PR page, from Activity and by a close webhook, each after its first $0.12 turn.
import { expect, test, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { onPrPage } from './support/api.ts';
import { FAIL_ONCE_PRS, HELD_PRS, LEVEL_TWO_REPOSITORY, releaseFile } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

const LEVEL_TWO = {
  fullName: LEVEL_TWO_REPOSITORY.fullName,
  installationId: LEVEL_TWO_REPOSITORY.installationId,
};

/** Held PR numbers per test, apart from live-progress.spec.ts (the first ten). */
const HELD = {
  prPage: HELD_PRS.from + 10,
  activity: HELD_PRS.from + 20,
  close: HELD_PRS.from + 30,
};

const nextStep = (page: Page) => page.getByRole('region', { name: 'Next step' });

/** The PR page's Timeline entry of this kind, after a reload of the page. */
async function timelineEntry(
  page: Page,
  number: number,
  entry: string,
  text: string,
  slug?: string,
) {
  const found = page
    .getByRole('list', { name: 'Timeline entries' })
    .locator(`[data-entry="${entry}"]`)
    .first();
  await onPrPage(
    page,
    number,
    async () => {
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await expect(found).toContainText(text, { timeout: 5_000 });
    },
    slug,
  );
  return found;
}

/** Opens the PR page once its held round reports the first turn. */
async function whileReviewRuns(page: Page, number: number): Promise<void> {
  await onPrPage(page, number, async () => {
    await expect(page.getByTestId('round-line')).toContainText('running · $0.12 so far', {
      timeout: 5_000,
    });
  });
}

test('a failed Review is retried from Review and reuses the stages before it', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = FAIL_ONCE_PRS.from + testInfo.retry;
  const slug = LEVEL_TWO_REPOSITORY.slug;
  await deliverPullRequest(request, 'ready_for_review', number, `Retry: ${number}`, LEVEL_TWO);

  await onPrPage(
    page,
    number,
    async () => {
      await expect(nextStep(page).getByRole('heading', { level: 2 })).toHaveText(
        "Round 1 failed at Review: the reviewer's answer was not valid. This round is not counted",
        { timeout: 5_000 },
      );
    },
    slug,
  );
  await nextStep(page).getByRole('button', { name: 'Retry from Review' }).click();

  // The retry's reviewer answers: the round finishes with the findings.
  await onPrPage(
    page,
    number,
    async () => {
      await expect(page.getByTestId('round-line')).toContainText(/finished \d\d:\d\d/, {
        timeout: 5_000,
      });
    },
    slug,
  );
  await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible();

  // Run detail of the retry: the stages before Review are reused, the failed run is linked.
  await page.getByRole('link', { name: 'Run details' }).click();
  const retryOf = page.getByTestId('run-retry-of');
  await expect(retryOf).toContainText('Retry from Review of failed run #');
  await expect(retryOf).toContainText('spent up to the failure');
  for (const stage of ['checks', 'task', 'change_type']) {
    await expect(page.locator(`[data-stage="${stage}"]`)).toContainText(
      'reused from the failed round',
    );
  }
  await expect(page.locator('[data-stage="review"]')).not.toContainText(
    'reused from the failed round',
  );

  // The failed run links forward to its retry.
  await retryOf.getByRole('link', { name: /failed run #\d+/ }).click();
  await expect(page.getByTestId('run-retried-by')).toBeVisible();

  const retried = await timelineEntry(
    page,
    number,
    'run_retried',
    'Retry from Review started',
    slug,
  );
  await expect(retried.getByTestId('entry-actor')).toHaveText('By hand');
});

test('Cancel on the PR page stops the round and records what it spent', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const number = HELD.prPage + testInfo.retry;
  await rm(releaseFile(number), { force: true });
  await deliverPullRequest(request, 'ready_for_review', number, `Cancel here ${number}`);

  await whileReviewRuns(page, number);
  await nextStep(page).getByRole('button', { name: 'Cancel' }).click();

  const cancelled = await timelineEntry(page, number, 'run_cancelled', 'Round 1 cancelled');
  await expect(cancelled.getByTestId('entry-actor')).toHaveText('By hand');
  await expect(cancelled.getByTestId('entry-cost')).toHaveText('$0.12');
  await expect(nextStep(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('Cancel in Activity stops a run in progress', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const number = HELD.activity + testInfo.retry;
  const title = `Cancel from Activity ${number}`;
  await rm(releaseFile(number), { force: true });
  await deliverPullRequest(request, 'ready_for_review', number, title);

  await page.goto('/activity');
  const row = page
    .getByRole('table', { name: 'In progress' })
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: title }) });
  await expect(row.getByTestId('run-cost')).toHaveText('$0.12', { timeout: 30_000 });
  await row.getByRole('button', { name: 'Cancel Round 1 of 3' }).click();
  // The live update takes the cancelled run out of the list.
  await expect(row).toHaveCount(0, { timeout: 15_000 });

  const cancelled = await timelineEntry(page, number, 'run_cancelled', 'Round 1 cancelled');
  await expect(cancelled.getByTestId('entry-actor')).toHaveText('By hand');
});

test('a close webhook cancels the PR’s active round', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const number = HELD.close + testInfo.retry;
  const title = `Closed while reviewed ${number}`;
  await rm(releaseFile(number), { force: true });
  await deliverPullRequest(request, 'ready_for_review', number, title);

  await whileReviewRuns(page, number);
  await deliverPullRequest(request, 'closed', number, title);

  const cancelled = await timelineEntry(page, number, 'run_cancelled', 'Run cancelled: PR closed');
  await expect(cancelled.getByTestId('entry-actor')).toHaveText('PR Review Agent');
  await expect(cancelled.getByTestId('entry-cost')).toHaveText('$0.12');
  await expect(
    page.getByRole('list', { name: 'Timeline entries' }).locator('[data-entry="pr_closed"]'),
  ).toBeVisible();
});
