// S-08-T11: the Notify author card after a signed review, on the S-01 stack with a ClickUp double
// (`NOTIFY_REPOSITORY`, task WB-123). The double writes each comment to `commentsFile`.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { bannerTitle, onPrPage, teamMember, writeHeaders } from './support/api.ts';
import { commentsFile, NOTIFY_REPOSITORY } from './support/env.ts';
import { AUTHOR_LOGIN, deliverPullRequest, stackState } from './support/github.ts';

const REPOSITORY = NOTIFY_REPOSITORY;
const KASIA_CLICKUP_USER = '4242';

/** Kasia (the fixtures' PR author) with a ClickUp user, and Tomek to sign the review. */
async function team(request: APIRequestContext): Promise<void> {
  const kasia = await teamMember(request, 'Kasia', AUTHOR_LOGIN);
  const { apiUrl } = stackState();
  const { members } = (await (await request.get(`${apiUrl}/api/team`)).json()) as {
    members: { id: string; clickupUserId: string | null }[];
  };
  if (members.find((m) => m.id === kasia.id)?.clickupUserId !== KASIA_CLICKUP_USER) {
    const response = await request.patch(`${apiUrl}/api/team/${kasia.id}`, {
      headers: writeHeaders(),
      data: { clickupUserId: KASIA_CLICKUP_USER, signedBy: kasia.id },
    });
    expect(response.status()).toBe(200);
  }
  await teamMember(request, 'Tomek', 'tomek');
}

async function reviewedPr(page: Page, request: APIRequestContext, number: number) {
  await team(request);
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `Notify: labels ${number}`,
    REPOSITORY,
  );
  await onPrPage(
    page,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText('Decide 3 findings', { timeout: 3_000 });
    },
    REPOSITORY.slug,
  );
}

const finding = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('button', { name: title }) });

async function opinion(page: Page, title: string, value: string): Promise<void> {
  const article = finding(page, title);
  const line = article.getByRole('button', { name: title });
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  await article.getByRole('button', { name: value }).click();
}

async function sign(page: Page, scope: Locator, name: string): Promise<void> {
  const combobox = scope.getByRole('combobox', { name: 'Signed by' });
  await combobox.click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(combobox).toContainText(name);
}

/** Tomek's review on the Findings tab: 2 worth implementing, 1 not worth it. */
async function saveReview(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /^Findings/ }).click();
  await opinion(page, 'Empty label hides the edge', 'Worth implementing');
  await opinion(page, 'Renaming drops the undo history', 'Worth implementing');
  await opinion(page, 'Rename helper name is vague', 'Not worth it');
  await page
    .getByRole('region', { name: 'Your review' })
    .getByRole('button', { name: 'Save review…' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Save your review' });
  await sign(page, dialog, 'Tomek');
  await dialog.getByRole('button', { name: 'Save review' }).click();
  await expect(dialog).toBeHidden();
}

/** The comments the ClickUp double got for this PR. */
async function commentsOn(
  number: number,
): Promise<{ taskId: string; text: string; mentionUserId: string }[]> {
  const lines = await readFile(commentsFile(stackState().holdDir), 'utf8').catch(() => '');
  return lines
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { taskId: string; text: string; mentionUserId: string })
    .filter((c) => c.text.endsWith(`in PR #${number}`));
}

const card = (page: Page) => page.getByRole('region', { name: 'Notify the author' });
const textFor = (number: number) =>
  `@Kasia: Tomek marked 2 findings as worth implementing and 1 finding as not worth it in PR #${number}`;

test('a signed review offers the exact ClickUp comment; Notify author posts it once', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 280 + testInfo.retry;
  await reviewedPr(page, request, number);
  const linked = await request.put(
    `${stackState().apiUrl}/api/prs/${REPOSITORY.slug}/${number}/task-link`,
    { headers: writeHeaders(), data: { taskIdOrUrl: REPOSITORY.task.customId } },
  );
  expect(linked.status()).toBe(200);
  await page.reload();

  await saveReview(page);
  await expect(card(page)).toContainText(
    "Tomek's review saved: 2 worth implementing, 1 not worth it",
  );
  await expect(card(page).getByTestId('notify-preview')).toHaveText(
    `ClickUp WB-123 · ${textFor(number)}`,
  );

  await card(page).getByRole('button', { name: 'Notify author' }).click();
  await expect(card(page)).toBeHidden();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Kasia notified in ClickUp' }),
  ).toBeVisible();
  expect(await commentsOn(number)).toEqual([
    {
      method: 'createComment',
      taskId: 'WB-123',
      text: textFor(number),
      mentionUserId: KASIA_CLICKUP_USER,
    },
  ]);
});

test('without a linked task the card says why and links one', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 283 + testInfo.retry;
  await reviewedPr(page, request, number);

  await saveReview(page);
  await expect(card(page)).toContainText(
    'No ClickUp task linked, so there is nowhere to notify Kasia.',
  );
  await expect(card(page).getByRole('button', { name: 'Notify author' })).toHaveCount(0);

  await card(page).getByRole('button', { name: 'Link a ClickUp task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a ClickUp task' });
  await dialog.getByLabel('Task ID or link').fill(REPOSITORY.task.customId);
  await dialog.getByRole('button', { name: 'Link task' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page).getByTestId('notify-preview')).toHaveText(
    `ClickUp WB-123 · ${textFor(number)}`,
  );

  await card(page).getByRole('button', { name: 'Not now' }).click();
  await expect(card(page)).toBeHidden();
  expect(await commentsOn(number)).toEqual([]);
});
