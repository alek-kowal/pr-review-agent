// S-08-T9: questions and signed reviews end to end (prototype flow B steps 1–2), then a second
// full review, on the level-2 repository. A PR in `QUESTION_PRS` gets 2 questions next to the
// scripted findings (2 Blocking,
// 1 Worth fixing, 1 Nit); once the brief carries the team's answers, the reviewer asks nothing and
// adds one finding. The second review is started by hand while the page is open, so its results
// wait behind "View new results".
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { bannerTitle, onPrPage, teamMember } from './support/api.ts';
import { briefFile, LEVEL_TWO_REPOSITORY, QUESTION_PRS } from './support/env.ts';
import { AUTHOR_LOGIN, deliverPullRequest, stackState } from './support/github.ts';

const EMPTY_LABEL = 'Should an empty label fall back to the edge id?';
const PUBLIC_SDK = 'Is EdgeLabel part of the public SDK?';
const OWN_ANSWER = 'Internal for now; we export it in 3.0.';

const WORTH = ['Empty label hides the edge', 'Renaming drops the undo history'];
const NOT_WORTH = 'Rename helper name is vague';
/** The finding only the second review reports. */
const NEW_FINDING = 'Long labels overflow the edge';

/** Level 1 (the WB default) allows no questions; level 2 allows 3. */
const REPOSITORY = LEVEL_TWO_REPOSITORY;

const holdFile = (number: number) => path.join(stackState().holdDir, `hold-${number}`);

const finding = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('button', { name: title }) });

async function openFinding(page: Page, title: string): Promise<Locator> {
  const article = finding(page, title);
  const line = article.getByRole('button', { name: title });
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  return article;
}

async function sign(page: Page, scope: Locator, name: string): Promise<void> {
  const combobox = scope.getByRole('combobox', { name: 'Signed by' });
  await combobox.click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(combobox).toContainText(name);
}

const toast = (page: Page, title: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: title });

test('answers and a signed review reach the next round, whose results wait', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const number = QUESTION_PRS.from + testInfo.retry;
  await teamMember(request, 'Kasia', AUTHOR_LOGIN);
  await teamMember(request, 'Tomek', 'tomek');
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `Questions: rename ${number}`,
    REPOSITORY,
  );

  // Step 1: Tomek answers both questions with one signature.
  await onPrPage(
    page,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText('Answer 2 questions', { timeout: 3_000 });
    },
    REPOSITORY.slug,
  );
  await page.getByRole('tab', { name: /^Questions/ }).click();
  const empty = page.getByRole('region', { name: EMPTY_LABEL });
  const sdk = page.getByRole('region', { name: PUBLIC_SDK });
  await expect(
    empty.getByText('Yes, show the edge id').locator('xpath=ancestor::label'),
  ).toContainText('Recommended');
  await empty.getByRole('radio', { name: /^Yes, show the edge id/ }).check();
  await sdk.getByRole('textbox', { name: 'Own answer' }).fill(OWN_ANSWER);
  await sign(page, page.getByRole('tabpanel'), 'Tomek');
  await page.getByRole('button', { name: 'Save 2 answers' }).click();
  await expect(empty).toContainText('Tomek answered');
  await expect(empty).toContainText('Yes, show the edge id');
  await expect(sdk).toContainText(OWN_ANSWER);
  await expect(bannerTitle(page)).not.toHaveText('Answer 2 questions');

  // Step 2: 2 Worth implementing, 1 Not worth it, saved as Tomek's review.
  await page.getByRole('tab', { name: /^Findings/ }).click();
  for (const title of WORTH) {
    const article = await openFinding(page, title);
    await expect(article).toContainText('Usually decided by: Kasia (author)');
    await article.getByRole('button', { name: 'Worth implementing' }).click();
  }
  const nit = await openFinding(page, NOT_WORTH);
  await nit.getByRole('button', { name: 'Not worth it' }).click();
  await nit.getByLabel('Comment for your opinion (optional)').fill('Naming can wait.');

  const tray = page.getByRole('region', { name: 'Your review' });
  await expect(tray).toContainText('Your review: 3 opinions');
  await expect(tray).toContainText('2 worth implementing, 1 not worth it');
  await tray.getByRole('button', { name: 'Save review…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your review' });
  await expect(dialog).toContainText('Kasia sees it before deciding');
  await sign(page, dialog, 'Tomek');
  await dialog.getByRole('button', { name: 'Save review' }).click();
  await expect(toast(page, "Tomek's review saved")).toBeVisible();
  await expect(tray).toBeHidden();
  await expect(finding(page, WORTH[0]!).getByTestId('opinion-counts')).toHaveAccessibleName(
    'Worth implementing: Tomek',
  );

  // A second full review, started by hand; the reviewer double holds it until the page is ready.
  await writeFile(holdFile(number), '');
  try {
    const header = page.locator('header', { has: page.getByRole('heading', { level: 1 }) });
    await header.getByRole('button', { name: 'Start review' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByText(/^Review started: round 1/)).toBeVisible();
    await onPrPage(
      page,
      number,
      async () => {
        await expect(bannerTitle(page)).toHaveText(/^Review running: started by hand/, {
          timeout: 3_000,
        });
      },
      REPOSITORY.slug,
    );
    await page.getByRole('tab', { name: /^Findings/ }).click();
    await expect(finding(page, WORTH[0]!)).toBeVisible();
  } finally {
    await rm(holdFile(number), { force: true });
  }

  // The round ends while the page is open: the banner moves on, the findings wait.
  const strip = page.getByTestId('new-results');
  await expect(strip).toContainText('New results from round 1', { timeout: 60_000 });
  await expect(bannerTitle(page)).not.toHaveText(/^Review running/);
  await expect(finding(page, NEW_FINDING)).toHaveCount(0);

  await strip.getByRole('button', { name: 'View new results' }).click();
  await expect(strip).toBeHidden();
  await expect(finding(page, NEW_FINDING)).toBeVisible();
  for (const title of WORTH) {
    const article = await openFinding(page, title);
    await expect(article.getByTestId('opinions').getByRole('listitem')).toContainText(
      'Tomek Worth implementing · from round 1',
    );
  }
  const carriedNit = await openFinding(page, NOT_WORTH);
  await expect(carriedNit.getByTestId('opinions').getByRole('listitem')).toContainText(
    'Tomek Not worth it · “Naming can wait.” · from round 1',
  );

  // The second reviewer got both answers; the first got none.
  const { holdDir } = stackState();
  expect(await readFile(briefFile(holdDir, number, 1), 'utf8')).not.toContain(
    'Answers from the team',
  );
  const brief = await readFile(briefFile(holdDir, number, 2), 'utf8');
  expect(brief).toContain(`Q: ${EMPTY_LABEL}`);
  expect(brief).toContain('A (Tomek): Yes, show the edge id');
  expect(brief).toContain(`A (Tomek): ${OWN_ANSWER}`);
});
