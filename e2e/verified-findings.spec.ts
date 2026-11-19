// S-05-T4: verified findings on the S-01 stack. A level-3 round runs Verify with the verifier and
// `Sandbox` doubles (stack.ts): one finding each Confirmed, Refuted and Not proven, with their
// quotes and reproductions; a level-2 round leaves every finding Unchecked.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEVEL_TWO_REPOSITORY, VERIFIED_REPOSITORY } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

/** Opens the Findings tab once the worker finished round 1 (findings show after Verify). */
async function openFindings(page: Page, slug: string, number: number): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/${slug}/${number}?tab=findings`);
    await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

/** Opens a finding's body and its technical details; returns the finding. */
async function openFinding(page: Page, name: string): Promise<Locator> {
  const finding = page.getByRole('article', { name });
  await finding.getByRole('button', { expanded: false }).click();
  await finding.getByText('Technical details').click();
  return finding;
}

test('a level-3 round shows each finding with its verdict, verbatim quotes and repro exit code', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const number = 31;
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    'Verified edge labels',
    VERIFIED_REPOSITORY,
  );
  await openFindings(page, VERIFIED_REPOSITORY.slug, number);

  const confirmed = await openFinding(page, 'Blocking: Empty label hides the edge');
  await expect(confirmed.getByTestId('verdict')).toHaveText('Confirmed');
  await expect(confirmed.getByText('Evidence quoted from the code')).toBeVisible();
  await expect(confirmed.locator('pre').first()).toHaveText(
    'export const label = (edge: { name: string }) => edge.name.trim();',
  );
  await expect(confirmed.getByText('exit 0: reproduced')).toBeVisible();
  await expect(confirmed.getByText(/bug reproduced/)).toBeVisible();

  const refuted = await openFinding(page, 'Blocking: Renaming drops the undo history');
  await expect(refuted.getByTestId('verdict')).toHaveText('Refuted');
  await expect(refuted.getByText('exit 3: does not happen')).toBeVisible();

  const notProven = await openFinding(page, 'Worth fixing: SDK entry exports an internal type');
  await expect(notProven.getByTestId('verdict')).toHaveText('Not proven');
  await expect(notProven.getByText("export * from './edges.ts';")).toBeVisible();
  await expect(notProven.getByText('exit 1: could not run')).toBeVisible();
  await expect(notProven.getByText(/this is the repaired one/)).toBeVisible();

  // The Refuted Blocking finding needs no decision: Confirmed and Not proven are left.
  await expect(page.getByText('Decide 2 findings').first()).toBeVisible();
});

test('a level-2 round shows "Unchecked (level 2)" on every finding', async ({ page, request }) => {
  test.setTimeout(150_000);
  const number = 32;
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    'Unverified edge labels',
    LEVEL_TWO_REPOSITORY,
  );
  await openFindings(page, LEVEL_TWO_REPOSITORY.slug, number);

  const verdicts = page.getByTestId('verdict');
  await expect(verdicts.first()).toBeVisible();
  const count = await verdicts.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await expect(verdicts.nth(i)).toHaveText('Unchecked (level 2)');
  await expect(page.getByText('Technical details')).toHaveCount(0);
});
