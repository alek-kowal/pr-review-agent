// S-12-T5: merge from the app end to end on the S-01 stack, in `MERGE_REPOSITORY` (level 1).
// Round 1 with its findings rejected leaves the PR Ready to merge with the CI row failing until a
// `check_suite` arrives; then "Merge #N…" needs the typed number and a signer, squash-merges, and
// the PR leaves the board. GitHub refuses the PRs in `REFUSED_MERGE_PRS`; a push removes Ready to
// merge at once.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { bannerTitle, decide, onPrPage, signer, sql } from './support/api.ts';
import { MERGE_REFUSAL, MERGE_REPOSITORY, REFUSED_MERGE_PRS } from './support/env.ts';
import {
  deliverCheckSuite,
  deliverPullRequest,
  deliverPush,
  FIXTURE_COMMITS,
  stackState,
} from './support/github.ts';

// Every PR here shares the fixture head, and a `check_suite` refreshes the CI of every open PR at
// that head: run this file's tests in order so one test's green CI cannot reach another's PR.
test.describe.configure({ mode: 'default' });

const { slug } = MERGE_REPOSITORY;
const TO_DECIDE = [
  'Empty label hides the edge',
  'Renaming drops the undo history',
  'SDK entry exports an internal type',
];

const short = (sha: string) => sha.slice(0, 7);
const banner = (page: Page) => page.getByRole('region', { name: 'Next step' });
const checklist = (page: Page) => page.getByTestId('checklist');

const stateOf = async (number: number) =>
  (
    await sql<{ state: string; merge_sha: string | null }>(
      `select p.state, p.merge_sha from pull_requests p
         join repositories r on r.id = p.repository_id
        where r.slug = $1 and p.number = $2`,
      [slug, number],
    )
  )[0];

/** Round 1 on PR `number` with its findings rejected: Ready to merge, CI not reported yet. */
async function readyToMerge(
  page: Page,
  request: APIRequestContext,
  number: number,
  title: string,
): Promise<void> {
  await deliverPullRequest(request, 'ready_for_review', number, title, MERGE_REPOSITORY);
  await onPrPage(
    page,
    number,
    async () => {
      await expect(page.getByTestId('pr-meta')).toContainText('Round 1 completed', {
        timeout: 3_000,
      });
    },
    slug,
  );
  await decide(request, number, TO_DECIDE, 'reject', slug);
  await onPrPage(
    page,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /, { timeout: 3_000 });
    },
    slug,
  );
}

/** GitHub's CI finishes on the head; the page shows the checklist green after a reload. */
async function ciGreen(page: Page, request: APIRequestContext, number: number): Promise<void> {
  const { headSha } = stackState();
  await deliverCheckSuite(request, MERGE_REPOSITORY, headSha);
  await onPrPage(
    page,
    number,
    async () => {
      await expect(checklist(page)).toContainText(`Checklist green at ${short(headSha)}`, {
        timeout: 3_000,
      });
    },
    slug,
  );
}

/** Opens the Merge dialog, types the number and signs as `name`; returns the dialog. */
async function fillMerge(page: Page, number: number, name: string): Promise<Locator> {
  await banner(page)
    .getByRole('button', { name: `Merge #${number}…` })
    .click();
  const dialog = page.getByRole('alertdialog', { name: `Merge #${number}` });
  await dialog.getByRole('textbox', { name: `Type ${number} to confirm` }).fill(String(number));
  await dialog.getByRole('combobox', { name: 'Signed by' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  return dialog;
}

test('a green PR merges after the typed number and a signature, and leaves the board', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 100 + testInfo.retry;
  const title = `Merge: green ${number}`;
  const { headSha } = stackState();
  const me = await signer(request);
  await readyToMerge(page, request, number, title);

  // No CI reported yet: that row fails, so the checklist is not green.
  await expect(checklist(page)).toHaveAttribute('data-checklist', 'open');
  await expect(checklist(page)).toContainText('CI green in GitHub');
  await expect(checklist(page)).toContainText('No CI checks reported yet.');
  await ciGreen(page, request, number);

  await banner(page)
    .getByRole('button', { name: `Merge #${number}…` })
    .click();
  const dialog = page.getByRole('alertdialog', { name: `Merge #${number}` });
  await expect(dialog).toContainText(
    `Squash merge at ${short(headSha)} into main. Cannot be undone from here.`,
  );
  await expect(dialog).toContainText(/Merge checklist: (\d) of \1 pass/);
  const confirm = dialog.getByRole('button', { name: `Merge #${number}` });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox', { name: `Type ${number} to confirm` }).fill(String(number));
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Signed by' }).click();
  await page.getByRole('option', { name: new RegExp(me.name) }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(`#${number} merged by ${me.name}`)).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await stateOf(number)).toMatchObject({ state: 'merged', merge_sha: expect.any(String) });

  await page.goto(`/pr/${slug}/${number}?tab=timeline`);
  await expect(page.getByText(`Squash-merged at ${short(headSha)}`)).toBeVisible();

  await page.goto('/prs');
  await expect(page.locator('[data-lane]').getByRole('link', { name: title })).toHaveCount(0);
  await page.getByText('Merged or closed in the last 7 days').click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});

test("GitHub's refusal shows its reason in the dialog and the PR stays open", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = REFUSED_MERGE_PRS.from + testInfo.retry;
  const title = `Merge: refused ${number}`;
  const me = await signer(request);
  await readyToMerge(page, request, number, title);
  await ciGreen(page, request, number);

  const dialog = await fillMerge(page, number, me.name);
  await dialog.getByRole('button', { name: `Merge #${number}` }).click();

  await expect(dialog.getByRole('alert')).toHaveText(
    `GitHub refused the merge: ${MERGE_REFUSAL.message}`,
  );
  await expect(dialog).toBeVisible();
  expect(await stateOf(number)).toMatchObject({ state: 'open', merge_sha: null });

  await page.goto(`/pr/${slug}/${number}?tab=timeline`);
  await expect(page.getByText(`GitHub refused the merge at`)).toContainText(MERGE_REFUSAL.message);
  await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /);
});

test('a push removes Ready to merge and the green CI of the old head', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 104 + testInfo.retry;
  const title = `Merge: pushed ${number}`;
  const { headSha, fixShas } = stackState();
  await readyToMerge(page, request, number, title);
  await ciGreen(page, request, number);

  await deliverPush(
    request,
    number,
    title,
    { headSha: fixShas[0]!, commits: FIXTURE_COMMITS + 1 },
    MERGE_REPOSITORY,
  );
  await onPrPage(
    page,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText(
        `1 new commit since last review (${short(headSha)})`,
        { timeout: 3_000 },
      );
    },
    slug,
  );
  await expect(page.getByText(/Ready to merge/)).toHaveCount(0);
  await expect(banner(page).getByRole('button', { name: /^Merge #/ })).toHaveCount(0);
  await expect(checklist(page)).toHaveAttribute('data-checklist', 'open');
  await expect(checklist(page)).toContainText('No CI checks reported yet.');
});
