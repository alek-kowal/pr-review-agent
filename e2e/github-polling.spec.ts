// P-28: polling GitHub until the GitHub App exists. While `githubModeFile` names a mode, the
// stack's GitHub double acts as `TokenGitHubGateway`: read-only, no webhooks, the poller on. This
// project runs alone, after every other spec (playwright.config.ts): a poll baselines every
// connected repository, importing its open PRs.
import { expect, test, type Page } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import { bannerTitle, decide, onPrPage, signer, sql, writeHeaders } from './support/api.ts';
import { githubModeFile, MERGE_REPOSITORY, POLLED_REPOSITORY } from './support/env.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

test.describe.configure({ mode: 'serial' });

const modeFile = () => githubModeFile(stackState().holdDir);
const useGitHubMode = (mode: 'token' | 'anonymous') => writeFile(modeFile(), mode);
test.afterAll(() => rm(modeFile(), { force: true }));

const READ_ONLY = 'Read-only: GitHub App not connected.';
const banner = (page: Page) => page.getByRole('region', { name: 'Next step' });
const TO_DECIDE = [
  'Empty label hides the edge',
  'Renaming drops the undo history',
  'SDK entry exports an internal type',
];

test('without the App, Merge is off with the reason and the API refuses it', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await rm(modeFile(), { force: true });
  const { slug } = MERGE_REPOSITORY;
  // No scripted behaviour (support/env.ts) and no other spec uses 140–149.
  const number = 140 + testInfo.retry;
  const member = await signer(request);

  // Ready to merge while the App is connected (a webhook starts round 1).
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `Polling: merge ${number}`,
    MERGE_REPOSITORY,
  );
  const roundDone = async () => {
    await expect(page.getByTestId('pr-meta')).toContainText('Round 1 completed', {
      timeout: 3_000,
    });
  };
  await onPrPage(page, number, roundDone, slug);
  await decide(request, number, TO_DECIDE, 'reject', slug);
  const ready = async () => {
    await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /, { timeout: 3_000 });
  };
  await onPrPage(page, number, ready, slug);
  await expect(banner(page).getByRole('button', { name: `Merge #${number}…` })).toBeEnabled();

  // The App goes away: the button stays, off, and says what to do instead.
  await useGitHubMode('token');
  await page.reload();
  const merge = banner(page).getByRole('button', { name: `Merge #${number}…` });
  await expect(merge).toBeDisabled();
  await expect(merge).toHaveAccessibleDescription(
    `${READ_ONLY} Merge in GitHub until the App is connected.`,
  );

  const refused = await request.post(`${stackState().apiUrl}/api/prs/${slug}/${number}/merge`, {
    headers: writeHeaders(),
    data: { typedNumber: number, signedBy: member.id },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: 'github_read_only' } });
});

test('a repository connected by name is polled: the first poll imports its open PR', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { fullName, defaultBranch, pr } = POLLED_REPOSITORY;
  const member = await signer(request);
  await useGitHubMode('token');

  // 1. Connect by owner/name: GitHub's default branch is prefilled; the connect is signed.
  await page.goto('/settings/repositories');
  await expect(page.getByRole('combobox', { name: 'Connect a repository' })).toHaveCount(0);
  const connected = page
    .getByRole('table', { name: 'Connected repositories' })
    .getByRole('link', { name: fullName, exact: true });
  // A retry finds it connected already.
  if ((await connected.count()) === 0) {
    await page.getByRole('textbox', { name: 'Repository (owner/name)' }).fill(fullName);
    await page.getByRole('button', { name: 'Connect…' }).click();
    await expect(
      page.getByRole('heading', { name: `Connect ${fullName}`, level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Default branch')).toHaveValue(defaultBranch);

    await page.getByRole('button', { name: 'Connect…' }).click();
    const dialog = page.getByRole('alertdialog', { name: `Connect ${fullName}` });
    await expect(dialog.getByRole('row', { name: /Default branch/ })).toContainText(defaultBranch);
    const signedBy = dialog.getByRole('combobox', { name: 'Signed by' });
    await signedBy.click();
    await page.getByRole('option', { name: new RegExp(member.name) }).click();
    await expect(signedBy).toContainText(member.name);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/repositories\/\d+$/);
    await expect(page.getByRole('heading', { name: fullName, level: 1 })).toBeVisible();
  }

  const [stored] = await sql<{ installation_id: number | null; branch: string }>(
    `select installation_id, config->>'defaultBranch' as branch from repositories
      where github_full_name = $1`,
    [fullName],
  );
  expect(stored).toEqual({ installation_id: null, branch: defaultBranch });
  const audit = await sql<{ count: number }>(
    `select count(*)::int as count from settings_changes
      where area = 'repositories' and after->>'githubFullName' = $1 and signer_id = $2`,
    [fullName, member.id],
  );
  expect(audit[0]?.count).toBe(1);

  // 2. Integrations shows the poller; Poll now baselines the repository.
  await page.goto('/settings/integrations');
  const poller = page.getByRole('region', { name: 'GitHub polling' });
  await expect(poller).toContainText('Read-only, with a personal token (GITHUB_TOKEN)');
  await expect(poller.getByRole('note')).toContainText('The GitHub App is not connected.');
  await poller.getByRole('button', { name: 'Poll now' }).click();
  await expect(poller).toContainText(/A poll is (queued|already waiting)/);
  await expect(async () => {
    await page.reload();
    await expect(poller).toContainText(new RegExp(`${fullName}· 1 open PR · baseline `), {
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });

  // 3. The baseline imports the PR to the board and starts no review.
  await page.goto('/prs');
  await expect(page.getByRole('link', { name: pr.title })).toBeVisible();
  const runs = await sql<{ count: number }>(
    `select count(*)::int as count from runs r
       join pull_requests p on p.id = r.pull_request_id
       join repositories o on o.id = p.repository_id
      where o.github_full_name = $1 and p.number = $2`,
    [fullName, pr.number],
  );
  expect(runs[0]?.count).toBe(0);

  // 4. Without a token GitHub allows 60 requests an hour; the card says so.
  await useGitHubMode('anonymous');
  await page.goto('/settings/integrations');
  await expect(poller).toContainText('Read-only, without a token: public repositories only');
  await expect(poller).toContainText('Without GITHUB_TOKEN GitHub allows 60 requests an hour.');
});
