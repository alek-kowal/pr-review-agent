// S-15-T5: the level 5 variants of prototype flow C, and the level 3 shadow, on the S-01 stack.
// At level 5 the bot decides, implements and pushes with no click; the pushed commit's
// `synchronize` runs the fix check to Ready to merge. A patch that touches a sensitive file waits
// with the reason and pushes nothing. At level 3 the Timeline says what level 5 would have done,
// and no implementer runs. Each test has its own PR (a retry takes the next number).
import { expect, test, type Page } from '@playwright/test';
import { ISOLATED_GIT_ENV } from '@pra/integrations/testing';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { bannerTitle, sql } from './support/api.ts';
import { AUTOFIX_PRS, AUTOFIX_REPOSITORY, pushBranch, SHADOW_REPOSITORY } from './support/env.ts';
import { deliverPullRequest, FIXTURE_COMMITS, stackState } from './support/github.ts';

type Repository = { slug: string; fullName: string; installationId: number };

const short = (sha: string) => sha.slice(0, 7);
const title = (number: number) => `Autofix edge labels ${number}`;

const run = promisify(execFile);
/** Git in the push remote, as GitHub sees the branch. */
const git = async (...args: string[]) =>
  (
    await run('git', ['-C', stackState().pushRemote, ...args], {
      env: { ...process.env, ...ISOLATED_GIT_ENV },
    })
  ).stdout.trim();

/** The argv of each `git push` the worker ran to `branch`. */
async function pushesTo(branch: string): Promise<string[][]> {
  const log = await readFile(stackState().gitPushes, 'utf8').catch(() => '');
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { args: string[] }).args)
    .filter((args) => args.some((arg) => arg.endsWith(`:refs/heads/${branch}`)));
}

/** Posts `pull_request.<fixture>` for PR `number` of `repository` on its own branch. */
const deliver = (
  page: Page,
  repository: Repository,
  fixture: 'ready_for_review' | 'synchronize',
  number: number,
  push?: { headSha: string; commits: number },
) =>
  deliverPullRequest(
    page.request,
    fixture,
    number,
    title(number),
    repository,
    push,
    pushBranch(number),
  );

const runsOf = (slug: string, number: number) =>
  sql<{ kind: string; trigger: string; round_no: number | null }>(
    `select r.kind, r.trigger, r.round_no from runs r
       join pull_requests p on p.id = r.pull_request_id
       join repositories s on s.id = p.repository_id
      where s.slug = $1 and p.number = $2 order by r.id`,
    [slug, number],
  );

/** Reloads the PR page (on `tab`) until `check` passes. */
async function untilPage(
  page: Page,
  slug: string,
  number: number,
  check: () => Promise<void>,
  { tab, timeout }: { tab?: string; timeout: number },
): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/${slug}/${number}${tab ? `?tab=${tab}` : ''}`);
    await check();
  }).toPass({ timeout });
}

const entry = (page: Page, kind: string) =>
  page.getByRole('list', { name: 'Timeline entries' }).locator(`[data-entry="${kind}"]`);

test('level 5: round 1, then the bot implements and pushes with no click; the fix check ends in Ready to merge', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const number = AUTOFIX_PRS.fixes.from + testInfo.retry;
  const branch = pushBranch(number);
  const { slug } = AUTOFIX_REPOSITORY;
  const { headSha } = stackState();
  await deliver(page, AUTOFIX_REPOSITORY, 'ready_for_review', number);

  // Nobody clicks: the bot's commit lands on the PR branch.
  let sha = headSha;
  await expect(async () => {
    sha = await git('rev-parse', `refs/heads/${branch}`);
    expect(sha).not.toBe(headSha);
  }).toPass({ timeout: 180_000 });
  const pushes = await pushesTo(branch);
  expect(pushes).toHaveLength(1);
  for (const arg of pushes[0]!) {
    expect(arg).not.toMatch(/^--force|^-f$|^\+/);
  }
  expect(await git('rev-parse', `${sha}^`)).toBe(headSha);
  expect(await git('log', '-1', '--format=%an', sha)).toBe('pr-review-agent[bot]');

  await untilPage(
    page,
    slug,
    number,
    async () => {
      await expect(entry(page, 'autofix_started')).toContainText(
        'Autofix started by pr-review-agent',
        { timeout: 3_000 },
      );
      await expect(entry(page, 'autofix_pushed')).toContainText(`Autofix pushed ${short(sha)}`, {
        timeout: 3_000,
      });
    },
    { tab: 'timeline', timeout: 60_000 },
  );

  // GitHub reports the pushed commit: the chain's next round checks the fix by itself.
  await deliver(page, AUTOFIX_REPOSITORY, 'synchronize', number, {
    headSha: sha,
    commits: FIXTURE_COMMITS + 1,
  });
  await untilPage(
    page,
    slug,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText(`Ready to merge at ${short(sha)}`, {
        timeout: 3_000,
      });
    },
    { timeout: 120_000 },
  );
  expect(await runsOf(slug, number)).toEqual([
    { kind: 'round', trigger: 'ready_for_review', round_no: 1 },
    { kind: 'implementer', trigger: 'autofix', round_no: null },
    { kind: 'round', trigger: 'own_fix', round_no: 2 },
  ]);
});

test('level 5: a patch that touches a sensitive file waits with the reason and pushes nothing', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const number = AUTOFIX_PRS.sensitive.from + testInfo.retry;
  const branch = pushBranch(number);
  const { slug } = AUTOFIX_REPOSITORY;
  const { headSha } = stackState();
  await deliver(page, AUTOFIX_REPOSITORY, 'ready_for_review', number);

  await untilPage(
    page,
    slug,
    number,
    async () => {
      await expect(bannerTitle(page)).toHaveText(
        'Autofix waiting: patch touches a sensitive file',
        { timeout: 3_000 },
      );
    },
    { timeout: 180_000 },
  );
  expect(await pushesTo(branch)).toHaveLength(0);
  expect(await git('rev-parse', `refs/heads/${branch}`)).toBe(headSha);
  const runs = await runsOf(slug, number);
  expect(runs.map((r) => `${r.kind}:${r.trigger}`)).toEqual([
    'round:ready_for_review',
    'implementer:autofix',
  ]);
});

test('level 3: the Timeline says what level 5 would have done, no implementer runs, and the Trust ladder counts it', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const number = AUTOFIX_PRS.shadow.from + testInfo.retry;
  const { slug } = SHADOW_REPOSITORY;
  await deliver(page, SHADOW_REPOSITORY, 'ready_for_review', number);

  await untilPage(
    page,
    slug,
    number,
    async () => {
      await expect(entry(page, 'autofix_shadow')).toHaveText(/Level 5 would have fixed 1 of 1/, {
        timeout: 3_000,
      });
    },
    { tab: 'timeline', timeout: 180_000 },
  );
  await expect(entry(page, 'autofix_started')).toHaveCount(0);
  expect((await runsOf(slug, number)).map((r) => r.kind)).toEqual(['round']);

  // Insights → Trust ladder: the PR is in the repository's shadow log (a retry adds its own PR).
  const response = await page.request.get(`${stackState().apiUrl}/api/insights/trust?repo=${slug}`);
  const { repositories } = (await response.json()) as {
    repositories: { shadow: { eligible: number; needed: number; prs: { number: number }[] } }[];
  };
  const { shadow } = repositories[0]!;
  expect(shadow.prs.map((pr) => pr.number)).toContain(number);
  await page.goto(`/insights/trust?repo=${slug}`);
  const log = page
    .getByRole('region', { name: slug })
    .getByRole('region', { name: 'Level 5 shadow log' });
  await expect(log).toContainText(`Not enough data yet (${shadow.eligible} of 5 PRs)`);
});
