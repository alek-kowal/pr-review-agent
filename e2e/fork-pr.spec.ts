// S-16-T4 (US-17): a fork PR waits for Start review by hand, then its round is read-only: install
// and reproductions are off for forks, the Sandbox double is never called, and every verdict rests
// on quotes only.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { bannerTitle, onPrPage, sql } from './support/api.ts';
import { VERIFIED_REPOSITORY } from './support/env.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

const FORK_OWNER = 'outside-contributor';
const { slug } = VERIFIED_REPOSITORY;

const runsOf = (number: number) =>
  sql<{ id: number; status: string; trigger: string }>(
    `select r.id, r.status, r.trigger from runs r
       join pull_requests p on p.id = r.pull_request_id
       join repositories x on x.id = p.repository_id
      where x.slug = $1 and p.number = $2
      order by r.id`,
    [slug, number],
  );

/** The Sandbox calls of run `runId`: each mounts the run's worktree (`run-<id>`). */
async function sandboxCallsOf(runId: number): Promise<unknown[]> {
  const log = await readFile(stackState().sandboxCalls, 'utf8').catch(() => '');
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { mounts: string[] })
    .filter((call) => call.mounts.some((dir) => dir.split(/[\\/]/).includes(`run-${runId}`)));
}

/** Opens a finding's body; a fork's finding has no reproduction, so no technical details. */
async function openFinding(page: Page, name: string): Promise<Locator> {
  const finding = page.getByRole('article', { name });
  await finding.getByRole('button', { expanded: false }).click();
  await expect(finding.getByText('Technical details')).toHaveCount(0);
  return finding;
}

test('a fork PR waits for Start review, then reviews read-only', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const number = 64 + testInfo.retry;
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `Fork edge labels ${number}`,
    VERIFIED_REPOSITORY,
    undefined,
    undefined,
    undefined,
    FORK_OWNER,
  );

  // A fork never starts a round by itself.
  await onPrPage(
    page,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText('Not reviewed yet', { timeout: 3_000 });
    },
    slug,
  );
  expect(await runsOf(number)).toEqual([]);

  // FORKS: the board hides fork PRs by default; "Show forks" lists them.
  const card = page
    .locator('[data-lane]')
    .getByRole('link', { name: `Fork edge labels ${number}` });
  await page.goto(`/prs?repo=${slug}`);
  await expect(page.locator('[data-lane="not_reviewed"]')).toBeVisible();
  await expect(page.getByText('Forks hidden')).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: 'Show forks' }).click();
  await expect(page).toHaveURL(/[?&]forks=all/);
  await expect(card).toBeVisible();
  await expect(page.getByText('Forks hidden')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/prs$/);
  await expect(card).toHaveCount(0);
  await page.goto(`/pr/${slug}/${number}`);

  const header = page.locator('header', { has: page.getByRole('heading', { level: 1 }) });
  await header.getByRole('button', { name: 'Start review' }).click();
  const form = page.getByRole('dialog');
  await expect(form).toContainText(
    'Read-only review: no install, reproductions, implementer or push.',
  );
  await form.getByRole('button', { name: 'Start review' }).click();
  await expect(page.getByText(/^Review started: round 1 at level 3/)).toBeVisible();

  // The round finishes with its findings verified.
  await expect
    .poll(async () => (await runsOf(number)).map((r) => r.status), { timeout: 90_000 })
    .toEqual(['completed']);
  const [run] = await runsOf(number);
  expect(run).toMatchObject({ trigger: 'manual' });
  await page.goto(`/pr/${slug}/${number}?tab=findings`);
  await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible();

  // Quotes only: the quoted finding is Confirmed, the one with only a script is Not proven.
  const quoted = await openFinding(page, 'Blocking: Empty label hides the edge');
  await expect(quoted.getByTestId('verdict')).toHaveText('Confirmed');
  await expect(quoted.getByText('Evidence quoted from the code')).toBeVisible();
  const scriptOnly = await openFinding(page, 'Blocking: Renaming drops the undo history');
  await expect(scriptOnly.getByTestId('verdict')).toHaveText('Not proven');

  // Run detail: install and reproductions off for forks; the Sandbox was never called.
  await page.goto(`/runs/${run!.id}`);
  await expect(page.locator('[data-stage="checks"]')).toContainText('Install: off for forks');
  await expect(page.locator('[data-stage="verify"]')).toContainText('Reproductions: off for forks');
  expect(await sandboxCallsOf(run!.id)).toEqual([]);
});
