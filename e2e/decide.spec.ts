// S-02-T10: signed decisions on findings, on the S-01 stack with the scripted reviewer
// (2 Blocking, 1 Worth fixing, 1 Nit).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { teamMember } from './support/api.ts';
import { DECIDE_PRS_FROM } from './support/env.ts';
import { AUTHOR_LOGIN, deliverPullRequest } from './support/github.ts';

const BLOCKING = ['Empty label hides the edge', 'Renaming drops the undo history'];
const WORTH_FIXING = 'SDK entry exports an internal type';

async function sign(page: Page, combobox: Locator, name: string): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(combobox).toContainText(name);
}

/** Opens the PR page once the worker stored the PR and round 1's findings are in. */
async function openReviewedPr(page: Page, number: number): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/workflowbuilder/${number}`);
    await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

const finding = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('button', { name: title }) });

async function openFinding(page: Page, title: string): Promise<Locator> {
  const article = finding(page, title);
  const line = article.getByRole('button', { name: title });
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  return article;
}

const bannerTitle = (page: Page) =>
  page.getByRole('region', { name: 'Next step' }).getByRole('heading', { level: 2 });

const toast = (page: Page, title: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: title });

test('people decide findings with a signature, undo, and meet a conflict', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  // Each retry (under 5) and each `--repeat-each` copy uses its own PRs, so it never sees another
  // attempt's decisions.
  const number = DECIDE_PRS_FROM + 10 * testInfo.repeatEachIndex + testInfo.retry;
  const allRejected = number + 5;
  await deliverPullRequest(request, 'ready_for_review', number, `Decide: edge labels ${number}`);
  const otherTitle = `Decide: reject all ${allRejected}`;
  await deliverPullRequest(request, 'ready_for_review', allRejected, otherTitle);

  // 1. Kasia is the author (her GitHub login), Tomek a teammate. Through the api, which other
  // specs adding them at the same moment cannot break (settings-team.spec.ts covers the Team page).
  await teamMember(request, 'Kasia', AUTHOR_LOGIN);
  await teamMember(request, 'Tomek', 'tomek');

  // 2. Two Blocking findings: Implement, signed by Kasia, in one bulk decision.
  await openReviewedPr(page, number);
  await expect(bannerTitle(page)).toHaveText('Decide 3 findings');
  await expect(page.getByRole('region', { name: 'Next step' })).toContainText(
    'usually Kasia (author)',
  );
  for (const title of BLOCKING) {
    await page.getByRole('checkbox', { name: `Select finding: ${title}` }).check();
  }
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Implement…' }).click();
  await sign(page, bar.getByRole('combobox', { name: 'Signed by' }), 'Kasia');
  await bar.getByRole('button', { name: 'Implement 2' }).click();
  await expect(bar).toBeHidden();
  // The Worth fixing finding still waits for a decision.
  await expect(bannerTitle(page)).toHaveText('Decide 1 finding');
  await expect(finding(page, BLOCKING[0]!).getByTestId('decision-badge')).toHaveText('Implement');

  // 3. Reject the third with a reason, signed by Tomek: now two findings wait for a fix.
  let third = await openFinding(page, WORTH_FIXING);
  await expect(third).toContainText('Usually decided by: Kasia (author)');
  await third.getByRole('button', { name: 'Reject…' }).click();
  await sign(page, third.getByRole('combobox', { name: 'Signed by' }), 'Tomek');
  await third.getByLabel('Reason (required)').fill('The type is public on purpose.');
  await third.getByLabel('Reason (required)').press('Enter');
  await expect(third.getByTestId('decided-by')).toContainText('Rejected by Tomek (author: Kasia)');
  await expect(third.getByTestId('decision-badge')).toHaveText('Rejected');
  await expect(bannerTitle(page)).toHaveText('2 findings to implement');

  // 4. Undo from the toast puts the finding back.
  await toast(page, '1 finding rejected').getByRole('button', { name: 'Undo' }).click();
  await expect(toast(page, 'Decision undone')).toBeVisible();
  await expect(third.getByTestId('decision-badge')).toHaveCount(0);
  await expect(bannerTitle(page)).toHaveText('Decide 1 finding');

  // 5. After a reload, the signature starts with this browser's last signer.
  await page.reload();
  third = await openFinding(page, WORTH_FIXING);
  await third.getByRole('button', { name: 'Defer to ClickUp…' }).click();
  await expect(third.getByRole('combobox', { name: 'Signed by' })).toContainText('Tomek');

  // 6. A second browser decides the same finding first; this one sees the conflict.
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await openReviewedPr(other, number);
    const theirs = await openFinding(other, WORTH_FIXING);
    await theirs.getByRole('button', { name: 'Implement…' }).click();
    await sign(other, theirs.getByRole('combobox', { name: 'Signed by' }), 'Kasia');
    await theirs.getByRole('button', { name: 'Implement', exact: true }).click();
    await expect(theirs.getByTestId('decided-by')).toContainText('Implement: decided by Kasia');
  } finally {
    await otherContext.close();
  }
  await third.getByRole('button', { name: 'Defer to ClickUp', exact: true }).click();
  await expect(third.getByRole('alert')).toContainText('Kasia decided this in the meantime.');
  await expect(third.getByTestId('decision-badge')).toHaveText('Implement');

  // 7. On a second PR every finding to decide is rejected: it is ready to merge.
  await openReviewedPr(page, allRejected);
  for (const title of [...BLOCKING, WORTH_FIXING]) {
    await page.getByRole('checkbox', { name: `Select finding: ${title}` }).check();
  }
  await bar.getByRole('button', { name: 'Reject…' }).click();
  await bar.getByLabel('Reason (required)').fill('Out of scope for this PR.');
  await expect(bar.getByRole('combobox', { name: 'Signed by' })).toContainText('Tomek');
  await bar.getByRole('button', { name: 'Reject 3' }).click();
  await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /);

  await page.goto('/prs');
  await expect(
    page.locator('[data-lane="ready_to_merge"]').getByRole('link', { name: otherTitle }),
  ).toBeVisible();
});
