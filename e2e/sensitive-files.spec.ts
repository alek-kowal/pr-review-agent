// S-11-T4: sensitive files end to end on the S-01 stack. `SENSITIVE_REPOSITORY`'s patterns match
// two of the fixture's changed files, so round 1 adds both as pending. Once the findings are
// decided the banner asks a person to approve them: Approve changes (by hand) or Send back…
// (signed, with a comment), which the author's next push turns back into pending.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bannerTitle, decide, onPrPage, signer, sql } from './support/api.ts';
import { SENSITIVE_REPOSITORY } from './support/env.ts';
import { deliverPullRequest, FIXTURE_COMMITS, stackState } from './support/github.ts';

const { slug } = SENSITIVE_REPOSITORY;
const MIGRATION = 'db/migrations/0001_edge_labels.sql';
const SDK_ENTRY = 'packages/sdk/src/index.ts';
const TO_DECIDE = [
  'Empty label hides the edge',
  'Renaming drops the undo history',
  'SDK entry exports an internal type',
];
const COMMENT = 'Split the migration from the rename.';

const banner = (page: Page) => page.getByRole('region', { name: 'Next step' });
const panel = (page: Page) => page.getByTestId('sensitive-files');

type FileRow = { path: string; status: string; actor: string | null; comment: string | null };

const filesOf = (number: number) =>
  sql<FileRow>(
    `select s.path, s.status, s.actor, s.comment from sensitive_files s
       join pull_requests p on p.id = s.pull_request_id
       join repositories r on r.id = p.repository_id
      where r.slug = $1 and p.number = $2 order by s.path`,
    [slug, number],
  );

/** Round 1 on PR `number` with its findings rejected: the PR now waits for its sensitive files. */
async function waitingForApproval(
  page: Page,
  request: APIRequestContext,
  number: number,
  title: string,
): Promise<void> {
  await deliverPullRequest(request, 'ready_for_review', number, title, SENSITIVE_REPOSITORY);
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
      await expect(bannerTitle(page)).toHaveText('Approve changes to 2 sensitive files', {
        timeout: 3_000,
      });
    },
    slug,
  );
}

test('Approve changes approves both files by hand and the PR is ready to merge', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 200 + testInfo.retry;
  await waitingForApproval(page, request, number, 'Sensitive files approved by hand');

  const files = panel(page);
  await expect(files.getByTestId('sensitive-status')).toHaveText('need approval');
  await expect(files).toContainText(MIGRATION);
  await expect(files).toContainText('Matches db/migrations/**. Migrations cannot be undone.');
  await expect(files).toContainText(SDK_ENTRY);
  await expect(files).toContainText(`Matches ${SDK_ENTRY}. The public SDK entry.`);

  await banner(page).getByRole('button', { name: 'Approve changes' }).click();
  await expect(page.getByText('Recorded as approved by hand.')).toBeVisible();
  await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /);
  await expect(files.getByTestId('sensitive-status')).toHaveText('approved by hand');
  expect(await filesOf(number)).toEqual([
    { path: MIGRATION, status: 'approved', actor: 'hand', comment: null },
    { path: SDK_ENTRY, status: 'approved', actor: 'hand', comment: null },
  ]);
});

test('Send back… signs a comment, and the next push asks for approval again', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 203 + testInfo.retry;
  const title = 'Sensitive files sent back';
  await waitingForApproval(page, request, number, title);
  const me = await signer(request);

  await banner(page).getByRole('button', { name: 'Send back…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send the sensitive files back' });
  await expect(dialog).toContainText(MIGRATION);
  await expect(dialog).toContainText(SDK_ENTRY);
  // Without a comment the author would not know what to change.
  await dialog.getByRole('button', { name: /^Send back to / }).click();
  await expect(dialog.getByRole('alert')).toContainText('Write a comment');

  await dialog.getByLabel('Comment for the author (required)').fill(COMMENT);
  const signedBy = dialog.getByRole('combobox', { name: 'Signed by' });
  await signedBy.click();
  await page.getByRole('option', { name: new RegExp(`^${me.name}`) }).click();
  await expect(signedBy).toContainText(me.name);
  await dialog.getByRole('button', { name: /^Send back to / }).click();
  await expect(dialog).toBeHidden();

  await expect(bannerTitle(page)).toHaveText(
    new RegExp(`^Sent back by ${me.name}: .+ changes 2 sensitive files$`),
  );
  await expect(banner(page).getByTestId('sensitive-line')).toHaveText(`"${COMMENT}"`);
  await expect(panel(page).getByTestId('sensitive-status')).toHaveText('sent back');
  expect((await filesOf(number)).map((f) => [f.status, f.actor, f.comment])).toEqual([
    ['sent_back', 'member', COMMENT],
    ['sent_back', 'member', COMMENT],
  ]);

  // The author pushes: both files wait for a person's OK again, without the old comment.
  const { fixShas } = stackState();
  await deliverPullRequest(request, 'synchronize', number, title, SENSITIVE_REPOSITORY, {
    headSha: fixShas[0]!,
    commits: FIXTURE_COMMITS + 1,
  });
  await onPrPage(
    page,
    number,
    async () => {
      await expect(panel(page).getByTestId('sensitive-status')).toHaveText('need approval', {
        timeout: 3_000,
      });
    },
    slug,
  );
  await expect(panel(page)).not.toContainText(COMMENT);
  expect((await filesOf(number)).map((f) => [f.status, f.comment])).toEqual([
    ['pending', null],
    ['pending', null],
  ]);
});
