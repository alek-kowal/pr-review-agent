// S-22-T11: prototype flow D and the Pipeline page on the S-01 stack. The scripted reviewer
// swaps its Nit for `TRIAL_RULE_FINDING` when the review rules it reads name the PR
// (`trialRule`), so the trial's run B differs from run A. The global `review-rules.md` is shared
// with every spec, but only this spec's PRs (`TRIAL_PRS`) react to the rule.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { onPrPage, signer, sql, WB_SLUG } from './support/api.ts';
import { TRIAL_PRS, TRIAL_RULE_FINDING, trialRule } from './support/env.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

const NIT = 'Rename helper name is vague';
const BOTH = [
  'Empty label hides the edge',
  'Renaming drops the undo history',
  'SDK entry exports an internal type',
];

type RoundRow = { id: number; status: string };
const roundsOf = (number: number) =>
  sql<RoundRow>(
    `select r.id, r.status from runs r join pull_requests p on p.id = r.pull_request_id
      where p.number = $1 and r.kind = 'round' order by r.id`,
    [number],
  );

/** The PR's lane, state and Next step, as the api serves them. */
async function nextStep(request: APIRequestContext, number: number) {
  const response = await request.get(`${stackState().apiUrl}/api/prs/${WB_SLUG}/${number}`);
  expect(response.ok()).toBe(true);
  const { nextStep } = (await response.json()) as {
    nextStep: { lane: string | null; state: string; banner: unknown; mainAction: unknown };
  };
  return {
    lane: nextStep.lane,
    state: nextStep.state,
    banner: nextStep.banner,
    action: nextStep.mainAction,
  };
}

async function roundsCompleted(number: number, count: number): Promise<RoundRow[]> {
  let rounds: RoundRow[] = [];
  await expect
    .poll(
      async () => {
        rounds = await roundsOf(number);
        return rounds.filter((r) => r.status === 'completed').length;
      },
      { timeout: 60_000 },
    )
    .toBe(count);
  return rounds;
}

async function openGlobalReviewRules(page: Page): Promise<void> {
  await page.goto('/settings/instructions');
  await page
    .getByRole('region', { name: 'Instructions' })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Global', exact: true }) })
    .getByRole('link', { name: 'review-rules.md', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeVisible();
}

test('edit review-rules, try it on a PR, compare, activate it, and see it in Pipeline', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  // A retry uses a new PR, whose rule the earlier attempt's versions do not hold.
  const number = TRIAL_PRS.from + testInfo.retry;
  const title = `Trial target ${number}`;
  const kasia = await signer(request);

  await deliverPullRequest(request, 'ready_for_review', number, title);
  await roundsCompleted(number, 1);
  await onPrPage(page, number, async () => {
    await expect(page.getByRole('region', { name: 'Nits' }).getByText(NIT)).toBeVisible({
      timeout: 3_000,
    });
  });
  const before = await nextStep(request, number);

  // Edit: the diff shows the new line; a note; Save as draft.
  await openGlobalReviewRules(page);
  const text = page.getByRole('textbox', { name: 'Text' });
  await text.press('ControlOrMeta+End');
  // The stored text ends with a newline, so the rule lands on a line of its own.
  await text.pressSequentially(trialRule(number));
  const diff = page.getByRole('region', { name: /^Changes against the active version/ });
  await expect(diff.locator('ins')).toContainText(trialRule(number));
  await page.getByRole('textbox', { name: 'Note' }).fill(`Name the API rule for #${number}`);
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(
    page.getByText('Draft saved. It changes nothing until it is activated.'),
  ).toBeVisible();
  const activate = page.getByRole('button', { name: /^Activate version \d+…$/ });
  const draftVersion = Number(/(\d+)/.exec((await activate.textContent()) ?? '')?.[1]);
  expect(draftVersion).toBeGreaterThanOrEqual(2);

  // Try on a PR: pick the PR, start the trial, land on its Compare page.
  await page.getByRole('button', { name: 'Try on a PR…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Pull request' }).click();
  await page.getByPlaceholder('Search pull requests').fill(`#${number}`);
  await page.getByRole('option', { name: new RegExp(`#${number} ${title}`) }).click();
  await dialog.getByRole('button', { name: 'Start the trial' }).click();
  await expect(page).toHaveURL(/\/settings\/experiments\/\d+$/);

  // Both runs finish with the doubles; Compare shows the buckets and both costs.
  const onlyA = page.getByRole('region', { name: 'Only in A' });
  await expect(async () => {
    await page.reload();
    await expect(onlyA).toContainText(NIT, { timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByRole('region', { name: 'Only in B' })).toContainText(
    TRIAL_RULE_FINDING.title,
  );
  const both = page.getByRole('region', { name: 'In both' });
  for (const finding of BOTH) await expect(both).toContainText(finding);
  await expect(page.getByRole('region', { name: 'Cost of A · active instructions' })).toContainText(
    '$0.31',
  );
  await expect(page.getByRole('region', { name: 'Cost of B · draft' })).toContainText('$0.31');

  // The trial left the PR alone: same lane, same Next step, still one round.
  expect(await nextStep(request, number)).toEqual(before);
  expect(await roundsOf(number)).toHaveLength(1);

  // Activate the draft, signed, from the Compare page's link.
  await page.getByRole('link', { name: `Go to activate version ${draftVersion}` }).click();
  await page.getByRole('button', { name: `Activate version ${draftVersion}…` }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('combobox', { name: 'Signed by' }).click();
  await page.getByRole('option', { name: new RegExp(kasia.name) }).click();
  await confirm.getByRole('button', { name: 'Make active' }).click();
  await expect(confirm).toBeHidden();

  // The next round on the PR freezes the new version; Run detail lists it.
  await page.goto(`/pr/${WB_SLUG}/${number}`);
  const header = page.locator('header', { has: page.getByRole('heading', { level: 1 }) });
  await header.getByRole('button', { name: 'Start review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start review' }).click();
  const rounds = await roundsCompleted(number, 2);
  await page.goto(`/runs/${rounds.at(-1)!.id}`);
  const versions = page.locator('section', {
    has: page.getByRole('heading', { name: 'Instruction versions' }),
  });
  await expect(
    versions
      .getByRole('list', { name: 'Instructions' })
      .getByRole('listitem')
      .filter({ hasText: 'review-rules.md' }),
  ).toContainText(`v${draftVersion}`);

  // Pipeline: Enter on the Review node opens its Sheet with the model and the new version.
  await page.goto('/settings/pipeline');
  const review = page.getByRole('button', { name: 'Review, from level 1' });
  await review.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Review' });
  const { stages } = (await (await request.get(`${stackState().apiUrl}/api/pipeline`)).json()) as {
    stages: { key: string; model: { model: string } | null }[];
  };
  const model = stages.find((s) => s.key === 'review')?.model?.model;
  expect(model).toMatch(/^claude-/);
  await expect(sheet).toContainText(model!);
  await expect(sheet.getByRole('link', { name: `review-rules.md v${draftVersion}` })).toBeVisible();
});
