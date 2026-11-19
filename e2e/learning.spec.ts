// S-23-T7: learning end to end on the S-01 stack (prototype flow E, US-13), in
// `LEARNING_REPOSITORY` (level 6). Two PRs closed earlier leave one lesson candidate each. A PR
// merged in the app (typed number and a signature) starts the analyst once GitHub's `closed`
// arrives; its proposal raises "Snapshot tables…" to 2 PRs. Settings → Learning edits it and
// accepts it, signed, as lessons.md v(N+1), which the next round's reviewer reads. The other
// candidate, at 1 PR, cannot be accepted, and the analyst never reads the PR author's comments.
import { expect, test, type Page } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { bannerTitle, decide, signer, sql } from './support/api.ts';
import {
  analystHoldFile,
  analystInputFile,
  LEARNING_COMMENTS,
  LEARNING_LESSONS,
  LEARNING_PRS,
  LEARNING_REPOSITORY,
  lessonsFile,
} from './support/env.ts';
import {
  AUTHOR_LOGIN,
  deliverCheckSuite,
  deliverPullRequest,
  stackState,
} from './support/github.ts';

const REPOSITORY = LEARNING_REPOSITORY;
const { slug } = REPOSITORY;
const { snapshot, source } = LEARNING_LESSONS;
/** Round 1's findings that wait for a decision at level 6: the Refuted one and the Nit do not. */
const TO_DECIDE = ['Empty label hides the edge', 'SDK entry exports an internal type'];
const EDITED =
  'When a README table lists files that a build script copies, generate the table or add a test that compares it with the script.';

const short = (sha: string) => sha.slice(0, 7);
const banner = (page: Page) => page.getByRole('region', { name: 'Next step' });

/** Reloads PR `number`'s page until `check` passes: a level 6 round runs every stage. */
async function onPrPage(page: Page, number: number, check: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/${slug}/${number}`);
    await check();
  }).toPass({ timeout: 120_000 });
}

/** How many analyses of these PRs finished. */
async function finishedAnalyses(numbers: number[]): Promise<number> {
  const [row] = await sql<{ n: number }>(
    `select count(*)::int as n from analyses a
       join pull_requests p on p.id = a.pull_request_id
       join repositories r on r.id = p.repository_id
      where r.slug = $1 and p.number = any($2) and a.status = 'finished'`,
    [slug, numbers],
  );
  return row?.n ?? 0;
}

/** The newest lessons.md version of the repository. */
async function lessonsVersion(): Promise<number> {
  const [row] = await sql<{ version: number }>(
    `select max(v.version)::int as version from instruction_versions v
       join instruction_files f on f.id = v.file_id
       join repositories r on r.id = f.repository_id
      where r.slug = $1 and f.file_key = 'lessons.md'`,
    [slug],
  );
  return row?.version ?? 0;
}

test('a merged level 6 PR raises a lesson to 2 PRs; accepted, the next round reads it', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300_000);
  const { retry } = testInfo;
  const merged = LEARNING_PRS.merged.from + retry;
  const next = LEARNING_PRS.next.from + retry;
  const earlier = [LEARNING_PRS.source.from + retry, LEARNING_PRS.snapshot.from + retry];
  const title = `docs(mcp): list readme/temporal/testing in the snapshot table (#${merged})`;
  const { headSha, holdDir } = stackState();
  const me = await signer(request);

  // A retry starts from no candidates: the earlier attempt may have raised or accepted them.
  await sql(
    'delete from lesson_candidates where repository_id = (select id from repositories where slug = $1)',
    [slug],
  );
  // Two PRs closed earlier, each with its own lesson: the source one, then the snapshot one.
  await deliverPullRequest(
    request,
    'closed',
    earlier[0]!,
    'fix(ui): override the grid color in the palette only',
    REPOSITORY,
  );
  await deliverPullRequest(
    request,
    'closed',
    earlier[1]!,
    'docs(mcp): describe the docs snapshot',
    REPOSITORY,
  );

  // Round 1 with its findings rejected and CI green: Ready to merge.
  await deliverPullRequest(request, 'ready_for_review', merged, title, REPOSITORY);
  await onPrPage(page, merged, async () => {
    await expect(page.getByTestId('pr-meta')).toContainText('Round 1 completed', {
      timeout: 3_000,
    });
  });
  await decide(request, merged, TO_DECIDE, 'reject', slug);
  await deliverCheckSuite(request, REPOSITORY, headSha);
  await onPrPage(page, merged, async () => {
    await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /, { timeout: 3_000 });
    await expect(page.getByTestId('checklist')).toContainText(
      `Checklist green at ${short(headSha)}`,
      { timeout: 3_000 },
    );
  });
  await expect.poll(() => finishedAnalyses(earlier), { timeout: 60_000 }).toBe(2);

  // Merge #N…: the typed number and a signature.
  await banner(page)
    .getByRole('button', { name: `Merge #${merged}…` })
    .click();
  const mergeDialog = page.getByRole('alertdialog', { name: `Merge #${merged}` });
  await mergeDialog
    .getByRole('textbox', { name: `Type ${merged} to confirm` })
    .fill(String(merged));
  await mergeDialog.getByRole('combobox', { name: 'Signed by' }).click();
  await page.getByRole('option', { name: new RegExp(me.name) }).click();
  await mergeDialog.getByRole('button', { name: `Merge #${merged}` }).click();
  await expect(page.getByText(`#${merged} merged by ${me.name}`)).toBeVisible();

  // GitHub then sends `closed` (merged): the bot starts the analyst, held until the page shows it.
  const learningLine = page.getByTestId('learning-line');
  const hold = analystHoldFile(holdDir, merged);
  await writeFile(hold, '');
  try {
    await deliverPullRequest(request, 'merged', merged, title, REPOSITORY);
    await expect(learningLine).toHaveText('Learning: Analyst is running', { timeout: 30_000 });
  } finally {
    await rm(hold, { force: true });
  }
  await expect(learningLine).toContainText('Learning: Analyst finished: 1 candidate', {
    timeout: 30_000,
  });

  // Settings → Learning: the snapshot lesson has 2 PRs now. Edit it, then Accept, signed.
  await learningLine.getByRole('link', { name: 'Open Learning' }).click();
  await expect(page).toHaveURL(/\/settings\/learning$/);
  const card = page.getByRole('article', { name: snapshot.title });
  await expect(card).toContainText('2 PRs');
  await card.getByRole('button', { name: 'Edit' }).click();
  await card.getByRole('textbox', { name: 'Lesson' }).fill(EDITED);
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText(EDITED);
  await expect(card).toContainText('Edited by hand');

  const before = await lessonsVersion();
  await card.getByRole('button', { name: 'Accept…' }).click();
  const acceptDialog = page.getByRole('dialog', { name: `Accept “${snapshot.title}”?` });
  await acceptDialog.getByRole('combobox', { name: 'Signed by' }).click();
  await page.getByRole('option', { name: new RegExp(me.name) }).click();
  await acceptDialog.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(acceptDialog).toBeHidden();
  await expect(card).toHaveCount(0);
  const lesson = page
    .getByRole('region', { name: 'Accepted lessons' })
    .getByRole('listitem')
    .filter({ hasText: snapshot.title });
  await expect(lesson).toContainText(`lessons.md v${before + 1}`);
  await expect(lesson).toContainText(EDITED);
  await expect(lesson).toContainText(`Accepted by ${me.name}`);

  // A lesson seen on 1 PR waits for one more.
  const waiting = page.getByRole('article', { name: source.title });
  await expect(waiting).toContainText('1 of 2 PRs: waits for one more');
  await expect(waiting.getByRole('button', { name: 'Accept…' })).toBeDisabled();

  // The next round's reviewer reads the accepted lesson in its lessons.md.
  await deliverPullRequest(
    request,
    'ready_for_review',
    next,
    'docs(mcp): generate the snapshot table',
    REPOSITORY,
  );
  await expect
    .poll(() => readFile(lessonsFile(holdDir, next, 1), 'utf8').catch(() => ''), {
      timeout: 120_000,
    })
    .toContain(EDITED);
  expect(await readFile(lessonsFile(holdDir, next, 1), 'utf8')).toContain(`## ${snapshot.title}`);

  // The analyst read the reviewer's comment, and none by the PR author.
  const input = JSON.parse(await readFile(analystInputFile(holdDir, merged), 'utf8')) as {
    pr: { number: number; state: string };
    comments: { author: string; body: string }[];
  };
  expect(input.pr).toMatchObject({ number: merged, state: 'merged' });
  expect(LEARNING_COMMENTS.author.login).toBe(AUTHOR_LOGIN);
  expect(input.comments).toEqual([
    expect.objectContaining({
      author: LEARNING_COMMENTS.reviewer.login,
      body: LEARNING_COMMENTS.reviewer.body,
    }),
  ]);
  expect(input.comments.map((c) => c.author)).not.toContain(AUTHOR_LOGIN);
});
