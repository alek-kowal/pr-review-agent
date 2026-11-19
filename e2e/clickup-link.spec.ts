// S-06-T8: the ClickUp task end to end on the S-01 stack, in `CLICKUP_REPOSITORY` (level 2, so the
// Task stage runs). A branch naming `WB-4821` links that task and Run detail's Task stage shows its
// text; a PR with no ID and no search hit shows "No ClickUp task linked" and a person links one by
// hand; a finding deferred to ClickUp gets its follow-up task from the ClickUp double.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { decide, onPrPage } from './support/api.ts';
import { CLICKUP_REPOSITORY, CLICKUP_TASKS } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

const { slug } = CLICKUP_REPOSITORY;
const { branch: branchTask, hand: handTask } = CLICKUP_TASKS;
const BRANCH = `feature/${branchTask.customId}-edge-labels`;

const panel = (page: Page) => page.getByTestId('task-panel');

/** Delivers PR `number` (on `branch` when given) and waits for its round 1 on the PR page. */
async function roundOneDone(
  page: Page,
  request: APIRequestContext,
  number: number,
  title: string,
  branch?: string,
): Promise<void> {
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    title,
    CLICKUP_REPOSITORY,
    undefined,
    branch,
  );
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
}

test("a branch with a task ID links the task, and Run detail's Task stage shows its text", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 120 + testInfo.retry;
  await roundOneDone(page, request, number, `ClickUp: branch ${number}`, BRANCH);

  const task = panel(page);
  await expect(
    task.getByRole('link', { name: `Open ${branchTask.customId} in ClickUp` }),
  ).toHaveAttribute('href', branchTask.url);
  await expect(task).toContainText(branchTask.name);
  await expect(task).toContainText(`${branchTask.customId} · found from the branch name`);

  await page.getByRole('link', { name: 'Run details' }).click();
  await expect(page.getByRole('heading', { name: `Round 1 of 3 on #${number}` })).toBeVisible();
  await page.locator('[data-stage="task"]').getByRole('button', { name: 'Task' }).click();
  const output = page.getByTestId('task-output');
  await expect(output).toContainText(branchTask.customId);
  await expect(output).toContainText(branchTask.name);
  await expect(output).toContainText('found from the branch name');
  await expect(output).toContainText(branchTask.description);
});

test('a PR with no task ID shows "No ClickUp task linked" and links one by hand', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 124 + testInfo.retry;
  await roundOneDone(page, request, number, `ClickUp: no task ${number}`);

  const task = panel(page);
  await expect(task).toContainText('No ClickUp task linked');
  await task.getByRole('button', { name: 'Link a ClickUp task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a ClickUp task' });
  await dialog.getByLabel('Task ID or link').fill('WB-404');
  await dialog.getByRole('button', { name: 'Link task' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('ClickUp has no task with this ID.');

  await dialog.getByLabel('Task ID or link').fill(handTask.customId);
  await dialog.getByRole('button', { name: 'Link task' }).click();
  await expect(dialog).toBeHidden();
  await expect(task.getByRole('link', { name: `Open ${handTask.customId} in ClickUp` })).toHaveText(
    handTask.name,
  );
  await expect(task).toContainText(`${handTask.customId} · linked by hand`);

  await page.goto(`/pr/${slug}/${number}?tab=timeline`);
  await expect(page.getByText(`Linked ClickUp task ${handTask.customId}`)).toBeVisible();
});

test('a finding deferred to ClickUp shows its follow-up task', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = 128 + testInfo.retry;
  const finding = 'SDK entry exports an internal type';
  await roundOneDone(page, request, number, `ClickUp: follow-up ${number}`, BRANCH);
  await decide(request, number, [finding], 'defer', slug);

  // The follow-up job starts after a short delay (an undo window), then the page refreshes live.
  await page.goto(`/pr/${slug}/${number}?tab=findings`);
  await page.getByRole('button', { name: new RegExp(finding) }).click();
  const card = page.getByRole('article', { name: new RegExp(finding) });
  const followUp = card.getByTestId('follow-up');
  await expect(followUp).toContainText('Deferred to ClickUp');
  await expect(
    followUp.getByRole('link', { name: /^Open follow-up task task-\d+ in ClickUp$/ }),
  ).toHaveAttribute('href', /^https:\/\/app\.clickup\.com\/t\/task-\d+$/, { timeout: 60_000 });
});
