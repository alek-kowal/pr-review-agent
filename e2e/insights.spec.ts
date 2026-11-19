// S-19-T8 (US-15): Insights on a seeded history (e2e/support/insights-seed.ts): 17 merged PRs in
// one repository (5 by ola), 3 in another, a trial and an analyst run.
import { expect, test, type Page } from '@playwright/test';
import { INSIGHTS_MAIN, INSIGHTS_SIDE } from './support/env.ts';

const NO_TREND = /[+-]\d+%|better|worse|trend/i;

async function expectNoTrend(page: Page) {
  await expect(page.getByRole('main')).not.toContainText(NO_TREND);
}

test('Overview, Cost, Quality and Trust ladder show sample sizes and no trend', async ({
  page,
}) => {
  // 1. Overview filtered to the repository with 17 merged PRs.
  await page.goto(`/insights?range=14&repo=${INSIGHTS_MAIN.slug}`);
  const tiles = page.getByRole('list', { name: 'Pilot metrics' }).getByRole('listitem');
  await expect(tiles).toHaveCount(5);
  for (const tile of await tiles.all()) {
    await expect(tile).toContainText('Based on 17 PRs merged');
    await expect(tile).not.toContainText('too few for firm conclusions');
  }
  const lanes = page.getByRole('region', { name: 'Where the time goes, ready → merge' });
  const values = lanes.getByRole('definition');
  await expect(values).toHaveCount(3);
  for (const value of await values.all()) await expect(value).toHaveText(/^\d+% .+/);
  await expectNoTrend(page);

  // 2. The author filter down to ola's 5 PRs adds "too few".
  await page.getByRole('combobox', { name: 'Author' }).click();
  await page.getByRole('option', { name: 'ola' }).click();
  await expect(page).toHaveURL(/author=ola/);
  for (const tile of await tiles.all()) {
    await expect(tile).toContainText('Based on 5 PRs merged · too few for firm conclusions');
  }

  // 3. Cost keeps trials and the analyst apart from PR cost.
  const tabs = page.getByRole('navigation', { name: 'Insights sections' });
  await tabs.getByRole('link', { name: 'Cost' }).click();
  await expect(page).toHaveURL(/\/insights\/cost\?/);
  const separate = page.getByRole('region', { name: 'Not in PR cost' });
  await expect(separate).toContainText('Trials$2.00');
  await expect(separate).toContainText('Analyst$1.50');
  await expect(page.getByRole('img', { name: 'Daily spend for the last 14 days' })).toBeVisible();
  // PR work: 17 rounds at $0.40 + i × $0.05.
  const prWork = Array.from({ length: 17 }, (_, i) => 0.4 + i * 0.05).reduce((a, b) => a + b, 0);
  await expect(page.getByRole('list', { name: 'Spend' })).toContainText(
    `Last 14 days$${prWork.toFixed(2)}`,
  );
  await expectNoTrend(page);

  // 4. Quality.
  await tabs.getByRole('link', { name: 'Quality' }).click();
  await expect(page.getByRole('table', { name: 'Per review level' })).toBeVisible();
  await expectNoTrend(page);

  // 5. Trust ladder, without the repository filter, shows both repositories.
  await page.goto('/insights/trust');
  await expect(page.getByRole('region', { name: INSIGHTS_MAIN.slug })).toContainText('Level 3 for');
  await expect(page.getByRole('region', { name: INSIGHTS_SIDE.slug })).toContainText('Level 1 for');
  await expectNoTrend(page);
});
