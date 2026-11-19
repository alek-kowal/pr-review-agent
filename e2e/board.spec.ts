// S-02-T10: the board's lanes come from the core state table.
// S-17-T8: filters in the address, the urgency sort, search, keyboard triage and the theme.
import { expect, test, type Page } from '@playwright/test';
import { onPrPage, teamMember } from './support/api.ts';
import {
  FAILING_PR_FROM,
  LEVEL_TWO_REPOSITORY,
  QUESTION_PRS,
  VERIFIED_REPOSITORY,
} from './support/env.ts';
import { AUTHOR_LOGIN, deliverPullRequest } from './support/github.ts';

const lane = (page: Page, key: string) => page.locator(`[data-lane="${key}"]`);
const cardLink = (page: Page, title: string) =>
  page.locator('[data-lane]').getByRole('link', { name: title });

/** Reloads the board until every title has a card: the worker stores PRs on its own time. */
async function onBoard(page: Page, titles: string[], path = '/prs'): Promise<void> {
  await expect(async () => {
    await page.goto(path);
    for (const title of titles) {
      await expect(cardLink(page, title)).toBeVisible({ timeout: 5_000 });
    }
  }).toPass({ timeout: 60_000 });
}

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

  const actionNeeded = lane(page, 'action_needed');
  const card = actionNeeded
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: title }) });
  // The board polls; reloading also covers the moment before the worker stored the PR.
  await expect(async () => {
    await page.goto('/prs');
    await expect(card).toContainText('Decide 3 findings', { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const notReviewed = lane(page, 'not_reviewed');
  await expect(notReviewed.getByRole('link', { name: draftTitle })).toBeVisible();
  await expect(actionNeeded.getByRole('link', { name: draftTitle })).toHaveCount(0);
});

test('Person = Kasia survives a reload in the address and shows only her PRs', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  // On this stack Kasia's GitHub login is the fixture author's, so the address reads
  // `?person=wb-dev`; Ola is an outside contributor with no signature anywhere.
  const kasia = await teamMember(request, 'Kasia', AUTHOR_LOGIN);
  const hers = `Board: Kasia's change ${230 + testInfo.retry}`;
  const olas = `Board: Ola's change ${233 + testInfo.retry}`;
  await deliverPullRequest(request, 'ready_for_review', 230 + testInfo.retry, hers);
  await deliverPullRequest(
    request,
    'ready_for_review',
    233 + testInfo.retry,
    olas,
    undefined,
    undefined,
    undefined,
    'ola',
  );
  await onBoard(page, [hers, olas]);

  const person = page.getByRole('combobox', { name: 'Person' });
  await person.click();
  await page.getByRole('option', { name: /^Kasia/ }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]person=${kasia.githubLogin}(&|$)`));
  await expect(cardLink(page, hers)).toBeVisible();
  await expect(cardLink(page, olas)).toHaveCount(0);

  await page.reload();
  await expect(person).toContainText('Kasia');
  await expect(cardLink(page, hers)).toBeVisible();
  await expect(cardLink(page, olas)).toHaveCount(0);
});

test('Filters → Level 3 plus Hide drafts narrows the lanes', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const levelThree = `Board: level 3 change ${236 + testInfo.retry}`;
  const levelThreeDraft = `Board: level 3 draft ${239 + testInfo.retry}`;
  const levelOne = `Board: level 1 change ${242 + testInfo.retry}`;
  await deliverPullRequest(
    request,
    'ready_for_review',
    236 + testInfo.retry,
    levelThree,
    VERIFIED_REPOSITORY,
  );
  await deliverPullRequest(
    request,
    'opened-draft',
    239 + testInfo.retry,
    levelThreeDraft,
    VERIFIED_REPOSITORY,
  );
  await deliverPullRequest(request, 'ready_for_review', 242 + testInfo.retry, levelOne);
  await onBoard(page, [levelThree, levelThreeDraft, levelOne]);

  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Review level').selectOption('3');
  await expect(page).toHaveURL(/[?&]level=3(&|$)/);
  await expect(cardLink(page, levelOne)).toHaveCount(0);
  await expect(cardLink(page, levelThreeDraft)).toBeVisible();

  await page.getByRole('checkbox', { name: 'Hide drafts' }).click();
  await expect(page).toHaveURL(/[?&]drafts=hide(&|$)/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Filters · 2' })).toBeVisible();
  await expect(cardLink(page, levelThree)).toBeVisible();
  await expect(cardLink(page, levelThreeDraft)).toHaveCount(0);
  await expect(cardLink(page, levelOne)).toHaveCount(0);
});

test('Action needed shows failed, then questions, then findings to decide', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  // The findings PR comes first, so it is the oldest: age alone would put it on top.
  const findings = `Board: urgency findings ${245 + testInfo.retry}`;
  const questions = `Board: urgency questions ${QUESTION_PRS.from + 6 + testInfo.retry}`;
  const failed = `Board: urgency failed ${FAILING_PR_FROM + 10 + testInfo.retry}`;
  await deliverPullRequest(request, 'ready_for_review', 245 + testInfo.retry, findings);
  // Level 1 drops questions, so the questions PR lives on the level-2 repository.
  await deliverPullRequest(
    request,
    'ready_for_review',
    QUESTION_PRS.from + 6 + testInfo.retry,
    questions,
    LEVEL_TWO_REPOSITORY,
  );
  await deliverPullRequest(
    request,
    'ready_for_review',
    FAILING_PR_FROM + 10 + testInfo.retry,
    failed,
  );

  const cards = lane(page, 'action_needed').getByRole('listitem');
  const card = (title: string) => cards.filter({ has: page.getByRole('link', { name: title }) });
  await expect(async () => {
    await page.goto('/prs');
    await expect(card(findings)).toContainText('Decide', { timeout: 5_000 });
    await expect(card(questions)).toContainText('question', { timeout: 5_000 });
    await expect(card(failed)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  // Other specs share the board: compare the positions of these three cards only.
  const texts = await cards.allInnerTexts();
  const at = (title: string) => texts.findIndex((text) => text.includes(title));
  expect(at(failed)).toBeGreaterThanOrEqual(0);
  expect(at(failed)).toBeLessThan(at(questions));
  expect(at(questions)).toBeLessThan(at(findings));
});

test('⌘K, typing 272 and Enter opens PR #272', async ({ page, request }) => {
  test.setTimeout(90_000);
  const title = 'Board: found by its number';
  await deliverPullRequest(request, 'ready_for_review', 272, title);
  await onBoard(page, [title]);

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('272');
  await expect(palette.getByRole('option').first()).toContainText('#272');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pr\/[^/]+\/272$/);
  await expect(palette).toBeHidden();
});

test('on Findings, j j i Enter decides with the prefilled signature', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const number = 248 + testInfo.retry;
  const kasia = await teamMember(request, 'Kasia', AUTHOR_LOGIN);
  await deliverPullRequest(request, 'ready_for_review', number, `Board: triage ${number}`);
  // This browser signed as Kasia before, so her signature is prefilled (`LAST_SIGNER_KEY`).
  await page.addInitScript(`localStorage.setItem('pra.lastSigner', ${JSON.stringify(kasia.id)})`);
  await onPrPage(page, number, async () => {
    await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible({ timeout: 5_000 });
  });

  // Shown order: the two Blocking findings, then Worth fixing, then the Nit.
  const second = page
    .getByRole('article')
    .filter({ has: page.getByRole('button', { name: 'Renaming drops the undo history' }) });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(
    second.getByRole('button', { name: 'Renaming drops the undo history' }),
  ).toBeFocused();
  await page.keyboard.press('i');
  const form = second.getByRole('form', { name: 'Implement', exact: true });
  await expect(form.getByRole('combobox')).toContainText('Kasia');
  await page.keyboard.press('Enter');

  await expect(form).toBeHidden();
  await expect(second.getByTestId('decided-by')).toContainText('Kasia');
  await expect(second.getByTestId('decision-badge')).toBeVisible();
});

test('? lists the shortcuts, and the theme toggle switches and survives a reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/prs');
  const html = page.locator('html');
  await expect(html).toHaveClass(/\blight\b/);
  // The keys listen once the app has rendered.
  const toDark = page.getByRole('button', { name: 'Switch to the dark theme' });
  await expect(toDark).toBeVisible();

  await page.keyboard.press('?');
  const list = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(list).toBeVisible();
  await expect(list).toContainText('Go to Activity');
  await expect(list).toContainText('Implement…');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  await toDark.click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole('button', { name: 'Switch to the light theme' }).click();
  await expect(html).toHaveClass(/\blight\b/);
});
