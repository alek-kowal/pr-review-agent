// S-07-T7: chains end to end on the S-01 stack (scripted reviewer: 2 Blocking, 1 Worth fixing,
// 1 Nit). The branch has three commits after the reviewed head (`fixShas`); a fix check resolves
// every finding except at the second, where the first stays unresolved. The expected head of a
// chain is seeded with SQL, as the implementer's push (S-14) sets it later.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import pg from 'pg';
import { deliverPullRequest, deliverPush, FIXTURE_COMMITS, stackState } from './support/github.ts';

const BLOCKING = ['Empty label hides the edge', 'Renaming drops the undo history'];
const WORTH_FIXING = 'SDK entry exports an internal type';

const short = (sha: string) => sha.slice(0, 7);

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: stackState().databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

type RunRow = { status: string; trigger: string; round_no: number; chain_id: string };

const roundsOf = (number: number) =>
  sql<RunRow>(
    `select r.status, r.trigger, r.round_no, r.chain_id from runs r
       join pull_requests p on p.id = r.pull_request_id
      where p.number = $1 and r.kind = 'round' order by r.id`,
    [number],
  );

const headOf = async (number: number) =>
  (
    await sql<{ head_sha: string }>('select head_sha from pull_requests where number = $1', [
      number,
    ])
  ).at(0)?.head_sha;

/** What S-14's push will do: the chain of the PR's latest round now waits for `sha`. */
async function expectHead(number: number, sha: string): Promise<void> {
  await sql(
    `update round_chains set expected_head_sha = $2 where id = (
       select r.chain_id from runs r join pull_requests p on p.id = r.pull_request_id
        where p.number = $1 and r.kind = 'round' order by r.id desc limit 1)`,
    [number, sha],
  );
}

/** While the file exists, the reviewer holds PR `number`'s review session. */
const holdFile = (number: number) => path.join(stackState().holdDir, `hold-${number}`);

const writeHeaders = () => ({ 'x-pra-request': '1', origin: stackState().apiUrl });

/** A Team member to sign with; the first one signs as themselves. */
async function signer(request: APIRequestContext): Promise<string> {
  const { apiUrl } = stackState();
  const members = async () =>
    ((await (await request.get(`${apiUrl}/api/team`)).json()) as { members: { id: string }[] })
      .members;
  const existing = (await members())[0];
  if (existing) return existing.id;
  // Another spec may add the first person at the same moment; then theirs signs.
  await request.post(`${apiUrl}/api/team`, {
    headers: writeHeaders(),
    data: { name: 'Kasia', githubLogin: 'wb-dev' },
  });
  return (await members())[0]!.id;
}

/** Decides the findings with these titles through the api (decide.spec.ts covers the UI). */
async function decide(
  request: APIRequestContext,
  number: number,
  titles: string[],
  decision: 'implement' | 'reject',
): Promise<void> {
  const { apiUrl } = stackState();
  const base = `${apiUrl}/api/prs/workflowbuilder/${number}`;
  const { findings } = (await (await request.get(`${base}/findings`)).json()) as {
    findings: { id: number; title: string; version: number }[];
  };
  const chosen = findings.filter((f) => titles.includes(f.title));
  expect(chosen).toHaveLength(titles.length);
  const response = await request.post(`${base}/decisions`, {
    headers: writeHeaders(),
    data: {
      findingIds: chosen.map((f) => f.id),
      decision,
      reason: decision === 'reject' ? 'Out of scope for this PR.' : null,
      signedBy: await signer(request),
      expectedVersions: Object.fromEntries(chosen.map((f) => [String(f.id), f.version])),
    },
  });
  expect(response.status()).toBe(200);
}

const bannerTitle = (page: Page) =>
  page.getByRole('region', { name: 'Next step' }).getByRole('heading', { level: 2 });

/** Reloads the PR page until `check` passes: the page does not follow the worker by itself. */
async function onPrPage(page: Page, number: number, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/workflowbuilder/${number}`);
    await check();
  }).toPass({ timeout: 60_000 });
}

const meta = (page: Page) => page.getByTestId('pr-meta');

async function roundOneDone(page: Page, number: number): Promise<void> {
  await onPrPage(page, number, async () => {
    await expect(meta(page)).toContainText('Round 1 completed', { timeout: 3_000 });
  });
}

test('Start review by hand at level 3 starts a new chain', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const number = 340 + testInfo.retry;
  const title = `Chains: start by hand ${number}`;
  await writeFile(holdFile(number), '');
  try {
    await deliverPullRequest(request, 'opened-draft', number, title);
    await onPrPage(page, number, async () => {
      await expect(meta(page)).toContainText('not reviewed yet', { timeout: 3_000 });
    });

    const header = page.locator('header', { has: page.getByRole('heading', { level: 1 }) });
    await header.getByRole('button', { name: 'Start review' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('combobox', { name: 'Review level' }).click();
    await page.getByRole('option', { name: /^3 · Verified/ }).click();
    await form.getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByText('Review started: round 1 at level 3.')).toBeVisible();

    await onPrPage(page, number, async () => {
      await expect(bannerTitle(page)).toHaveText(/^Review running: started by hand \(round 1/, {
        timeout: 3_000,
      });
    });
    const [run] = await roundsOf(number);
    expect(run).toMatchObject({ trigger: 'manual', round_no: 1, status: 'running' });
  } finally {
    await rm(holdFile(number), { force: true });
  }
  await roundOneDone(page, number);
  await expect(meta(page)).toContainText('level 3');
});

test('an author push starts nothing and counts the new commits', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 343 + testInfo.retry;
  const title = `Chains: author push ${number}`;
  const { headSha, fixShas } = stackState();
  await deliverPullRequest(request, 'ready_for_review', number, title);
  await roundOneDone(page, number);
  await decide(request, number, [...BLOCKING, WORTH_FIXING], 'reject');
  await page.reload();
  await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /);

  await deliverPush(request, number, title, { headSha: fixShas[1]!, commits: FIXTURE_COMMITS + 2 });
  await onPrPage(page, number, async () => {
    await expect(bannerTitle(page)).toHaveText(
      `2 new commits since last review (${short(headSha)})`,
      { timeout: 3_000 },
    );
  });
  await expect(page.getByText(/Ready to merge/)).toHaveCount(0);
  await expect(meta(page)).toContainText(`Reviewed ${short(headSha)} · 2 new commits since`);
  expect(await roundsOf(number)).toHaveLength(1);
});

test('a fix push on the expected head starts a fix check; a chain stops after 3 rounds', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const number = 346 + testInfo.retry;
  const title = `Chains: fix pushes ${number}`;
  const { fixShas } = stackState();
  const [fix1, fix2, fix3] = fixShas as [string, string, string];
  await deliverPullRequest(request, 'ready_for_review', number, title);
  await roundOneDone(page, number);
  await decide(request, number, BLOCKING, 'implement');
  await decide(request, number, [WORTH_FIXING], 'reject');
  await page.reload();
  await expect(bannerTitle(page)).toHaveText('2 findings to implement');

  // Round 2: the push is the expected fix, so it checks the fixes only.
  await expectHead(number, fix1);
  await deliverPush(request, number, title, { headSha: fix1, commits: FIXTURE_COMMITS + 1 });
  await onPrPage(page, number, async () => {
    await expect(meta(page)).toContainText(`Round 2 completed · Reviewed ${short(fix1)}`, {
      timeout: 3_000,
    });
  });
  await expect(page.getByText('2 of 2 fixes resolved')).toBeVisible();
  await expect(bannerTitle(page)).toHaveText(`Ready to merge at ${short(fix1)}`);

  // Round 3 leaves one fix unresolved: the chain has used its automatic rounds.
  await expectHead(number, fix2);
  await deliverPush(request, number, title, { headSha: fix2, commits: FIXTURE_COMMITS + 2 });
  await onPrPage(page, number, async () => {
    await expect(meta(page)).toContainText('Round 3 completed', { timeout: 3_000 });
  });
  await expect(page.getByText('1 of 2 fixes resolved')).toBeVisible();
  await expect(bannerTitle(page)).toHaveText('Automatic rounds used (3 of 3)');

  // A fourth fix on the expected head starts nothing.
  await expectHead(number, fix3);
  await deliverPush(request, number, title, { headSha: fix3, commits: FIXTURE_COMMITS + 3 });
  await expect.poll(() => headOf(number), { timeout: 15_000 }).toBe(fix3);
  await page.reload();
  await expect(bannerTitle(page)).toHaveText('Automatic rounds used (3 of 3)');

  const rounds = await roundsOf(number);
  expect(rounds.map((r) => [r.round_no, r.trigger, r.status])).toEqual([
    [1, 'ready_for_review', 'completed'],
    [2, 'own_fix', 'completed'],
    [3, 'own_fix', 'completed'],
  ]);
  expect(new Set(rounds.map((r) => r.chain_id)).size).toBe(1);
});

test('a push during a running round leaves it running and labels its result', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 349 + testInfo.retry;
  const title = `Chains: push while running ${number}`;
  const { headSha, fixShas } = stackState();
  await writeFile(holdFile(number), '');
  try {
    await deliverPullRequest(request, 'ready_for_review', number, title);
    await expect
      .poll(async () => (await roundsOf(number)).map((r) => r.status), { timeout: 30_000 })
      .toEqual(['running']);

    await deliverPush(request, number, title, {
      headSha: fixShas[1]!,
      commits: FIXTURE_COMMITS + 2,
    });
    await expect.poll(() => headOf(number), { timeout: 15_000 }).toBe(fixShas[1]);
    expect((await roundsOf(number)).map((r) => r.status)).toEqual(['running']);
  } finally {
    await rm(holdFile(number), { force: true });
  }

  await roundOneDone(page, number);
  await expect(meta(page)).toContainText(`Reviewed ${short(headSha)} · 2 new commits since`);
  await expect(bannerTitle(page)).toHaveText(`2 new commits since last review (${short(headSha)})`);
});
