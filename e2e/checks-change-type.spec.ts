// S-04-T7: Checks and change type end to end. A level-two round runs Checks, Task and Change type
// before Review (the stepper shows them in that order while a held reviewer runs); the Change type
// panel shows the rules' type, and Run detail shows the CI counts and the install result. A PR
// over the repository's large-PR limit shows the warning on the PR page and in Run detail.
import { expect, test, type Page } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import { onPrPage } from './support/api.ts';
import { HELD_PRS, LARGE_PR_REPOSITORY, LEVEL_TWO_REPOSITORY, releaseFile } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

/** Held PR numbers for this spec, apart from live-progress and retry-cancel (+0 to +39). */
const HELD_PR = HELD_PRS.from + 40;
/** Not held, not failing: the reviewer answers at once. */
const LARGE_PR = 220;

const changeTypePanel = (page: Page) => page.getByRole('region', { name: 'Change type' });

/** The `data-step` / `data-stage` keys in page order. */
const keysOf = (page: Page, attribute: 'data-step' | 'data-stage') =>
  page
    .locator(`[${attribute}]`)
    .evaluateAll((items, name) => items.map((item) => item.getAttribute(name)), attribute);

/** Opens a collapsed stage row in Run detail (only Review, failed and running rows start open). */
async function expandStage(page: Page, stage: string): Promise<void> {
  const toggle = page.locator(`[data-stage="${stage}"] > button`).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

test('a level-two round runs Checks, Task and Change type before Review', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = HELD_PR + testInfo.retry;
  const slug = LEVEL_TWO_REPOSITORY.slug;
  await rm(releaseFile(number), { force: true });
  await deliverPullRequest(request, 'ready_for_review', number, `Checks: ${number}`, {
    fullName: LEVEL_TWO_REPOSITORY.fullName,
    installationId: LEVEL_TWO_REPOSITORY.installationId,
  });

  // While the held reviewer runs, the stages before it have finished in order. The worker runs one
  // stage job at a time, so the hold is released even when a check fails.
  try {
    await onPrPage(
      page,
      number,
      async () => {
        await expect(page.locator('[data-step="review"]')).toHaveAttribute(
          'data-status',
          'running',
          { timeout: 5_000 },
        );
      },
      slug,
    );
    expect((await keysOf(page, 'data-step')).slice(0, 4)).toEqual([
      'checks',
      'task',
      'change_type',
      'review',
    ]);
    for (const step of ['checks', 'task', 'change_type']) {
      await expect(page.locator(`[data-step="${step}"]`)).toHaveAttribute('data-status', 'done');
    }
  } finally {
    await writeFile(releaseFile(number), 'release');
  }

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
  await expect(changeTypePanel(page).getByTestId('change-type')).toHaveText(/· set by the rules$/);
  await expect(changeTypePanel(page).getByTestId('large-pr-warning')).toHaveCount(0);

  // Run detail: the same order, and the Checks output with the fixture's CI and the install.
  await page.getByRole('link', { name: 'Run details' }).click();
  await expect(page.locator('[data-stage="review"]')).toBeVisible();
  expect((await keysOf(page, 'data-stage')).slice(0, 4)).toEqual([
    'checks',
    'task',
    'change_type',
    'review',
  ]);
  await expandStage(page, 'checks');
  const checks = page.getByTestId('checks-output');
  await expect(checks).toContainText('2 passed · 1 failed · 0 pending');
  await expect(checks).toContainText('Install passed');
  await expandStage(page, 'change_type');
  await expect(page.getByTestId('change-type-output')).toContainText('set by the rules');
  await expect(page.getByTestId('change-type-output').getByTestId('large-pr-warning')).toHaveCount(
    0,
  );
});

test('a PR over the large-PR limit shows the warning on the PR page and in Run detail', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const number = LARGE_PR + testInfo.retry;
  const slug = LARGE_PR_REPOSITORY.slug;
  await deliverPullRequest(request, 'ready_for_review', number, `Large: ${number}`, {
    fullName: LARGE_PR_REPOSITORY.fullName,
    installationId: LARGE_PR_REPOSITORY.installationId,
  });

  // The panel reads the latest completed round, so the warning shows once the round finished.
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
  const warning = changeTypePanel(page).getByTestId('large-pr-warning');
  await expect(warning).toContainText('over the 1-line limit');
  await expect(warning).toContainText('Consider splitting it into smaller PRs.');

  await page.getByRole('link', { name: 'Run details' }).click();
  await expect(page.locator('[data-stage="change_type"]')).toBeVisible();
  await expandStage(page, 'change_type');
  const output = page.getByTestId('change-type-output');
  await expect(output.getByTestId('large-pr-warning')).toContainText('over the 1-line limit');
});
