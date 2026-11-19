// S-14-T5: the second half of prototype flow C on the S-01 stack. A level 4 PR gets a patch from
// the implementer double; Push, typed number and signature send one non-forced commit by the bot
// to the PR branch in the push repository's bare remote (stack.ts). Its `synchronize` runs
// "Round 2 of 3" as a fix check; a moved head refuses the push; a person's commit on top of the
// bot's starts nothing (US-06). Serial: the specs share one Team member as the signer.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ISOLATED_GIT_ENV } from '@pra/integrations/testing';
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { bannerTitle, sql, teamMember, writeHeaders, type TeamMember } from './support/api.ts';
import {
  movedHeadFile,
  PUSH_PRS,
  PUSH_REPOSITORY,
  PUSH_SIGNER,
  pushBranch,
} from './support/env.ts';
import { deliverPullRequest, FIXTURE_COMMITS, stackState } from './support/github.ts';

test.describe.configure({ mode: 'serial' });

const TO_IMPLEMENT = ['Empty label hides the edge', 'SDK entry exports an internal type'];
const SLUG = PUSH_REPOSITORY.slug;
const short = (sha: string) => sha.slice(0, 7);
const title = (number: number) => `Push edge labels ${number}`;

const run = promisify(execFile);
/** Git in the push repository's bare remote, as GitHub sees the branch. */
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

const banner = (page: Page) => page.getByRole('region', { name: 'Next step' });
const meta = (page: Page) => page.getByTestId('pr-meta');

const roundsOf = (number: number) =>
  sql<{ trigger: string; round_no: number }>(
    `select r.trigger, r.round_no from runs r
       join pull_requests p on p.id = r.pull_request_id
       join repositories s on s.id = p.repository_id
      where s.slug = $1 and p.number = $2 and r.kind = 'round' order by r.id`,
    [SLUG, number],
  );

/** Posts `pull_request.<fixture>` for PR `number` on its own branch of the push repository. */
const deliver = (
  page: Page,
  fixture: 'ready_for_review' | 'synchronize',
  number: number,
  push?: { headSha: string; commits: number },
) =>
  deliverPullRequest(
    page.request,
    fixture,
    number,
    title(number),
    PUSH_REPOSITORY,
    push,
    pushBranch(number),
  );

/** Round 1 at level 4, then Implement with agent (signed) on two findings: Patch ready. */
async function patchReady(page: Page, number: number, kasia: TeamMember): Promise<void> {
  await deliver(page, 'ready_for_review', number);
  const base = `${stackState().apiUrl}/api/prs/${SLUG}/${number}`;
  await expect(async () => {
    await page.goto(`/pr/${SLUG}/${number}`);
    await expect(banner(page)).toContainText('Decide 2 findings', { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  const { findings } = (await (await page.request.get(`${base}/findings`)).json()) as {
    findings: { id: number; title: string; version: number }[];
  };
  const chosen = findings.filter((f) => TO_IMPLEMENT.includes(f.title));
  expect(chosen).toHaveLength(2);
  const decided = await page.request.post(`${base}/decisions`, {
    headers: writeHeaders(),
    data: {
      findingIds: chosen.map((f) => f.id),
      decision: 'implement',
      reason: null,
      signedBy: kasia.id,
      expectedVersions: Object.fromEntries(chosen.map((f) => [String(f.id), f.version])),
      withAgent: true,
    },
  });
  expect(decided.status()).toBe(200);

  await expect(async () => {
    await page.goto(`/pr/${SLUG}/${number}`);
    await expect(banner(page)).toContainText('Patch ready: 2 of 2 fixed, reproductions pass', {
      timeout: 5_000,
    });
  }).toPass({ timeout: 90_000 });
}

async function sign(page: Page, combobox: Locator, name: string): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(combobox).toContainText(name);
}

/** From Patch ready: Push, type the PR number, sign as Kasia, confirm. Returns the dialog. */
async function push(page: Page, number: number): Promise<Locator> {
  const branch = pushBranch(number);
  await banner(page)
    .getByRole('button', { name: `Push to ${branch}…` })
    .click();
  const dialog = page.getByRole('alertdialog', { name: `Push to ${branch}` });
  await expect(dialog).toContainText('2 of 2 fixed · reproductions pass');
  const confirm = dialog.getByRole('button', { name: `Push to ${branch}` });
  await dialog.getByRole('textbox', { name: `Type ${number} to confirm` }).fill(String(number));
  await sign(page, dialog.getByRole('combobox', { name: 'Signed by' }), 'Kasia');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  return dialog;
}

/** The branch head in the remote once the worker's push moved it off the reviewed commit. */
async function pushedHead(number: number): Promise<string> {
  const { headSha } = stackState();
  let sha = headSha;
  await expect(async () => {
    sha = await git('rev-parse', `refs/heads/${pushBranch(number)}`);
    expect(sha).not.toBe(headSha);
  }).toPass({ timeout: 60_000 });
  return sha;
}

let kasia: TeamMember;
test.beforeEach(async ({ request }) => {
  kasia = await teamMember(request, 'Kasia', PUSH_SIGNER.login);
});

test('main path: one signed, non-forced push; its synchronize runs Round 2 of 3 to Ready to merge', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const number = PUSH_PRS.from;
  const branch = pushBranch(number);
  const { headSha } = stackState();
  await patchReady(page, number, kasia);

  const dialog = await push(page, number);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Pushing to ${branch}`)).toBeVisible();

  const sha = await pushedHead(number);
  const pushes = await pushesTo(branch);
  expect(pushes).toHaveLength(1);
  for (const arg of pushes[0]!) {
    expect(arg).not.toMatch(/^--force|^-f$|^\+/);
  }
  // One commit on top of the reviewed head: a fast-forward, by the bot, with the signer.
  expect(await git('rev-parse', `${sha}^`)).toBe(headSha);
  expect(await git('log', '-1', '--format=%an', sha)).toBe('pr-review-agent[bot]');
  expect(await git('log', '-1', '--format=%B', sha)).toContain(
    `Co-authored-by: ${kasia.name} <${PUSH_SIGNER.id}+${PUSH_SIGNER.login}@users.noreply.github.com>`,
  );

  // GitHub reports the pushed commit: the chain's next round checks the fixes by itself.
  await deliver(page, 'synchronize', number, { headSha: sha, commits: FIXTURE_COMMITS + 1 });
  await expect(async () => {
    await page.goto(`/pr/${SLUG}/${number}`);
    await expect(meta(page)).toContainText(`Round 2 completed · Reviewed ${short(sha)}`, {
      timeout: 3_000,
    });
    // A round that ends while the page is open waits behind "View new results" (S-08-T8).
    await expect(page.getByText('2 of 2 fixes resolved')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
  expect(await roundsOf(number)).toEqual([
    { trigger: 'ready_for_review', round_no: 1 },
    { trigger: 'own_fix', round_no: 2 },
  ]);
  await expect(bannerTitle(page)).toHaveText(`Ready to merge at ${short(sha)}`);
});

test('a head that moved before the click refuses the push with the reason; nothing is pushed', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const number = PUSH_PRS.from + 1;
  const { headSha, holdDir, fixShas } = stackState();
  const moved = fixShas[0]!;
  await patchReady(page, number, kasia);
  await writeFile(movedHeadFile(holdDir, number), moved);
  try {
    const dialog = await push(page, number);

    await expect(dialog.getByRole('alert')).toHaveText(
      `The head moved to ${short(moved)} after the patch was made. Start review to check the new commits.`,
    );
    await expect(dialog).toBeVisible();
    expect(await pushesTo(pushBranch(number))).toHaveLength(0);
    expect(await git('rev-parse', `refs/heads/${pushBranch(number)}`)).toBe(headSha);
  } finally {
    await rm(movedHeadFile(holdDir, number), { force: true });
  }
});

test("a person's commit on top of the bot's commit starts no round; the banner shows new commits", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const number = PUSH_PRS.from + 2;
  const branch = pushBranch(number);
  const { headSha } = stackState();
  await patchReady(page, number, kasia);
  await push(page, number);
  const bot = await pushedHead(number);

  // Before GitHub reports the bot's commit, a person pushes one more on top of it.
  const person = await git('commit-tree', `${bot}^{tree}`, '-p', bot, '-m', 'Tweak the label');
  await git('update-ref', `refs/heads/${branch}`, person, bot);
  await deliver(page, 'synchronize', number, { headSha: person, commits: FIXTURE_COMMITS + 2 });

  await expect(async () => {
    await page.goto(`/pr/${SLUG}/${number}`);
    await expect(bannerTitle(page)).toHaveText(
      `2 new commits since last review (${short(headSha)})`,
      { timeout: 3_000 },
    );
  }).toPass({ timeout: 60_000 });
  expect(await roundsOf(number)).toEqual([{ trigger: 'ready_for_review', round_no: 1 }]);
});
