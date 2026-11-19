// S-18-T8: alerts end to end (US-14) on the S-01 stack. A PR in `CLICKUP_REPOSITORY` (task WB-4821
// from its branch) fails at Review; Retry from Review costs $5.50 (`COSTLY_RETRY_PRS`), so the
// failed-run alert clears and the cost alert fires: on the card bell, the board strip, the banner
// line, the chip and Activity, and as one ClickUp comment on the PR's task. Dismiss moves it to past
// alerts and the Timeline records it by hand. A failing PR without a task alerts the general task.
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { onPrPage, WB_SLUG } from './support/api.ts';
import {
  CLICKUP_REPOSITORY,
  CLICKUP_TASKS,
  commentsFile,
  COSTLY_RETRY_PRS,
  FAILING_PR_FROM,
  GENERAL_ALERTS_TASK,
  WEB_URL,
} from './support/env.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

const { slug } = CLICKUP_REPOSITORY;
const TASK = CLICKUP_TASKS.branch.customId;
const BRANCH = `feature/${TASK}-edge-labels`;

/** Failing PR numbers per test, apart from first-round.spec.ts (the first ones). */
const NO_TASK_PR = FAILING_PR_FROM + 60;

type Comment = { taskId: string; text: string };

/** The ClickUp comments the double holds for PR `number`. */
async function commentsFor(number: number): Promise<Comment[]> {
  const lines = await readFile(commentsFile(stackState().holdDir), 'utf8').catch(() => '');
  return lines
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Comment)
    .filter((c) => c.text.includes(`PR #${number}\n`));
}

const nextStep = (page: Page) => page.getByRole('region', { name: 'Next step' });
const activeAlerts = (page: Page) => page.getByRole('table', { name: 'Alerts', exact: true });

test('a costly retry clears the failed-run alert and raises the cost alert everywhere', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const number = COSTLY_RETRY_PRS.from + testInfo.retry;
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `Alerts: ${number}`,
    CLICKUP_REPOSITORY,
    undefined,
    BRANCH,
  );

  // Review fails: the failed-run alert shows in the banner, posted to the PR's task.
  await onPrPage(
    page,
    number,
    async () => {
      await expect(page.locator('[data-alert-line="failed"]')).toContainText(
        `Posted to ClickUp ${TASK}`,
        { timeout: 5_000 },
      );
    },
    slug,
  );
  await nextStep(page).getByRole('button', { name: 'Retry from Review' }).click();

  // The retry spends $5.50: the cost alert replaces the failed-run alert.
  await onPrPage(
    page,
    number,
    async () => {
      const line = page.locator('[data-alert-line="cost"]');
      await expect(line).toContainText(/Cost \$5\.\d\d, above the \$5\.00 threshold · alert/, {
        timeout: 5_000,
      });
      await expect(line).toContainText(`Posted to ClickUp ${TASK}`, { timeout: 5_000 });
      await expect(page.locator('[data-alert-line="failed"]')).toHaveCount(0);
    },
    slug,
  );

  // The status chip counts it.
  await expect(
    page.getByRole('button', { name: /^Factory status: .*, \d+ active alerts?$/ }),
  ).toBeVisible();

  // The board: the card bell and the strip, which links to Activity.
  await page.goto('/prs');
  const card = page.locator('li', { hasText: `Alerts: ${number}` }).first();
  await expect(card.locator('[data-card-alert]')).toBeVisible();
  const strip = page.locator('[data-alert-strip]');
  await expect(strip.getByRole('link', { name: new RegExp(`#${number} Cost \\$5`) })).toBeVisible();
  await strip.getByRole('link', { name: 'All alerts' }).click();
  await expect(page).toHaveURL(/\/activity$/);

  // Activity: the cost alert is active with Dismiss; no failed-run alert for this PR.
  const costRow = activeAlerts(page)
    .locator('[data-alert-kind="cost"]')
    .filter({ hasText: `#${number} has cost` });
  await expect(costRow).toBeVisible();
  await expect(
    activeAlerts(page)
      .locator('[data-alert-kind="failed"]')
      .filter({ hasText: `#${number}` }),
  ).toHaveCount(0);

  // ClickUp: one comment for the failed run and one for the cost, none for the clear.
  await expect.poll(async () => (await commentsFor(number)).length, { timeout: 10_000 }).toBe(2);
  const comments = await commentsFor(number);
  const costComments = comments.filter((c) => c.text.includes('above the $5.00 alert threshold'));
  expect(costComments).toHaveLength(1);
  expect(costComments[0]!.taskId).toBe(TASK);
  expect(costComments[0]!.text).toContain(`${WEB_URL}/pr/${slug}/${number}`);
  expect(costComments[0]!.text).toContain('pr-review-agent');
  expect(comments.every((c) => c.taskId === TASK)).toBe(true);

  // Dismiss: the alert moves to past alerts.
  const alertId = await costRow.getAttribute('data-alert');
  await costRow.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('Alert dismissed')).toBeVisible();
  await expect(activeAlerts(page).locator(`[data-alert="${alertId}"]`)).toHaveCount(0);
  await page.locator('[data-past-alerts]').click();
  const past = page.getByRole('table', { name: /^Show \d+ past alerts?$/ });
  await expect(past.locator(`[data-alert="${alertId}"]`)).toContainText('dismissed by hand');

  // The Timeline records it by hand; no new ClickUp comment.
  await onPrPage(
    page,
    number,
    async () => {
      await page.getByRole('tab', { name: 'Timeline' }).click();
      const entry = page
        .getByRole('list', { name: 'Timeline entries' })
        .locator('[data-entry="alert_dismissed"]');
      await expect(entry).toContainText('Dismissed the alert', { timeout: 5_000 });
      await expect(entry.getByTestId('entry-actor')).toHaveText('By hand');
    },
    slug,
  );
  await expect(page.locator('[data-alert-line="cost"]')).toHaveCount(0);
  expect(await commentsFor(number)).toHaveLength(2);
});

test('an alert on a PR without a task goes to the general alerts task', async ({
  request,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const number = NO_TASK_PR + testInfo.retry;
  await deliverPullRequest(request, 'ready_for_review', number, `No task: ${number}`);

  await expect
    .poll(async () => (await commentsFor(number)).map((c) => c.taskId), { timeout: 60_000 })
    .toEqual([GENERAL_ALERTS_TASK]);
  const [comment] = await commentsFor(number);
  expect(comment!.text).toContain(`${WEB_URL}/pr/${WB_SLUG}/${number}`);

  await onPrPage(page, number, async () => {
    await expect(page.locator('[data-alert-line="failed"]')).toContainText(
      `Posted to ClickUp ${GENERAL_ALERTS_TASK} (general alerts task)`,
      { timeout: 5_000 },
    );
  });
});
