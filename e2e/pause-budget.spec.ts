// S-10-T7: pause, budget and queue end to end on the S-01 stack. The spec pauses the whole factory,
// so it runs in its own Playwright project before every other spec, and it restores the state.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  bannerTitle,
  onPrPage,
  signer,
  sql,
  WB_SLUG,
  writeHeaders,
  type TeamMember,
} from './support/api.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

/** Agent sessions recorded for PR `number`: none means no agent was called. */
async function agentSessions(number: number): Promise<number> {
  const [row] = await sql<{ n: number }>(
    `select count(*)::int as n from agent_sessions s
       join stage_executions e on e.id = s.stage_execution_id
       join runs r on r.id = e.run_id
       join pull_requests p on p.id = r.pull_request_id
       join repositories repo on repo.id = p.repository_id
     where repo.slug = $1 and p.number = $2`,
    [WB_SLUG, number],
  );
  return row!.n;
}

/** The status chip while the factory runs (its name starts with the group's label). */
const RUNNING = /^Factory status: Running ·/;

/** Opens the status chip from the top bar. */
async function openChip(page: Page, name: RegExp): Promise<Locator> {
  await page.getByRole('button', { name }).click();
  const panel = page.getByRole('group', { name: 'Factory status' });
  await expect(panel).toBeVisible();
  return panel;
}

async function sign(page: Page, panel: Locator, member: TeamMember): Promise<void> {
  const combobox = panel.getByRole('combobox', { name: 'Signed by' });
  if ((await combobox.textContent())?.includes(member.name)) return;
  await combobox.click();
  await page.getByRole('option', { name: new RegExp(member.name) }).click();
  await expect(combobox).toContainText(member.name);
}

/** Running again with no budget, whatever the spec reached (a 409 means it already was). */
async function restore(request: APIRequestContext, member: TeamMember): Promise<void> {
  const { apiUrl } = stackState();
  const signed = { headers: writeHeaders(), data: { signedBy: member.id } };
  await request.post(`${apiUrl}/api/status/resume`, signed);
  const budget = await request.put(`${apiUrl}/api/status/budget`, {
    ...signed,
    data: { dailyBudgetUsd: null, signedBy: member.id },
  });
  expect(budget.status()).toBe(200);
}

test('pause queues a round with its reason, Resume starts it, the budget holds the next', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const pausedPr = 260 + testInfo.retry;
  const budgetPr = 265 + testInfo.retry;
  const kasia = await signer(request);
  const [{ since }] = (await sql<{ since: Date }>('select now() as since', [])) as [
    { since: Date },
  ];

  try {
    // Pause, signed, in the status chip.
    await page.goto('/prs');
    let panel = await openChip(page, RUNNING);
    await panel.getByLabel('Pause the factory').fill('release freeze');
    await sign(page, panel, kasia);
    await panel.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(
      page.getByRole('button', { name: `Paused by ${kasia.name} (release freeze)` }),
    ).toBeVisible();

    // A PR marked ready waits in the queue and says why; no agent works on it.
    await deliverPullRequest(request, 'ready_for_review', pausedPr, `Pause: held ${pausedPr}`);
    const pausedTitle = `Queued: paused by ${kasia.name} (release freeze)`;
    await onPrPage(page, pausedPr, async () => {
      await expect(bannerTitle(page)).toHaveText(pausedTitle, { timeout: 5_000 });
    });
    expect(await agentSessions(pausedPr)).toBe(0);
    await page.goto('/activity');
    await expect(page.getByRole('table', { name: 'In progress' })).toContainText(pausedTitle);

    // Resume… on the banner opens the chip; Resume (signed) lets the round start and finish.
    await page.goto(`/pr/${WB_SLUG}/${pausedPr}`);
    await page.getByRole('button', { name: 'Resume…' }).click();
    panel = page.getByRole('group', { name: 'Factory status' });
    await sign(page, panel, kasia);
    await panel.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: RUNNING })).toBeVisible();
    await onPrPage(page, pausedPr, async () => {
      await expect(bannerTitle(page)).toHaveText(/^Decide \d+ findings/, { timeout: 5_000 });
    });
    expect(await agentSessions(pausedPr)).toBeGreaterThan(0);

    // A daily budget below today's spend: the chip says so and the next PR waits for it.
    panel = await openChip(page, RUNNING);
    await panel.getByLabel('Daily budget $').fill('0.01');
    await sign(page, panel, kasia);
    await panel.getByRole('button', { name: 'Save budget' }).click();
    await expect(
      page.getByRole('button', { name: /^Factory status: Daily budget reached · \$/ }),
    ).toBeVisible();

    await deliverPullRequest(request, 'ready_for_review', budgetPr, `Budget: held ${budgetPr}`);
    await onPrPage(page, budgetPr, async () => {
      await expect(bannerTitle(page)).toHaveText(
        /^Queued: daily budget reached \(\$\d+\.\d\d of \$0\.01\)$/,
        { timeout: 5_000 },
      );
    });
    expect(await agentSessions(budgetPr)).toBe(0);

    // Pause, resume and the budget are signed entries of the one audit log.
    const audit = await sql<{ entity: string; signer_id: string; after: unknown }>(
      `select entity, signer_id, after from settings_changes
        where area = 'budget' and at >= $1 order by id`,
      [since],
    );
    expect(audit.map((row) => [row.entity, row.signer_id])).toEqual([
      ['status', kasia.id],
      ['status', kasia.id],
      ['daily_budget', kasia.id],
    ]);
    expect(audit[0]!.after).toMatchObject({ paused: true, reason: 'release freeze' });
    expect(audit[1]!.after).toMatchObject({ paused: false });
    expect(audit[2]!.after).toMatchObject({ dailyBudgetUsd: 0.01 });
  } finally {
    await restore(request, kasia);
  }

  // Without the budget the held round starts by itself.
  await onPrPage(page, budgetPr, async () => {
    await expect(bannerTitle(page)).toHaveText(/^Decide \d+ findings/, { timeout: 5_000 });
  });
});
