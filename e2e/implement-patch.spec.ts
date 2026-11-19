// S-13-T7: the first half of prototype flow C on the S-01 stack, with the implementer, GitMirror
// and Sandbox doubles (stack.ts). A level 3 round leaves two findings to decide; raising the PR
// to level 4 lets one signed Implement start the implementer; the Patch tab edits, reverts and
// revises the patch. Serial: one hold flag holds every implementer session.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { IMPLEMENTER_HOLD, IMPLEMENTER_REPOSITORY } from './support/env.ts';
import { AUTHOR_LOGIN, deliverPullRequest, stackState } from './support/github.ts';

test.describe.configure({ mode: 'serial' });

const TO_DECIDE = ['Empty label hides the edge', 'SDK entry exports an internal type'];
const EDGES = 'apps/demo/src/edges.ts';
const SDK = 'packages/sdk/src/index.ts';
const holdFile = () => path.join(stackState().holdDir, IMPLEMENTER_HOLD);

/** Adds a Team member on the Team page; a retry finds them already there. */
async function ensureMember(page: Page, name: string, login: string): Promise<void> {
  await page.goto('/settings/team');
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  await expect(page.getByText('Loading Team…')).toBeHidden();
  const table = page.getByRole('table', { name: 'Team members' });
  if ((await table.getByText(`@${login}`).count()) > 0) return;

  await page.getByRole('button', { name: 'Add a person' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a person to Team' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('GitHub login').fill(login);
  // Anyone already in Team signs the new person in (the stack seeds members for Insights).
  const signer = dialog.getByRole('combobox', { name: 'Signed by' });
  if ((await signer.count()) > 0) {
    await signer.click();
    await page.getByRole('option').first().click();
  }
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect(dialog).toBeHidden();
  await expect(table).toContainText(`@${login}`);
}

async function sign(page: Page, combobox: Locator, name: string): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(combobox).toContainText(name);
}

const banner = (page: Page) => page.getByRole('region', { name: 'Next step' });

/** Opens the PR once round 1 finished at level 3 with two findings to decide. */
async function openReviewedPr(page: Page, number: number): Promise<void> {
  await deliverPullRequest(
    page.request,
    'ready_for_review',
    number,
    'Implementer edge labels',
    IMPLEMENTER_REPOSITORY,
  );
  await expect(async () => {
    await page.goto(`/pr/${IMPLEMENTER_REPOSITORY.slug}/${number}?tab=findings`);
    await expect(banner(page)).toContainText('Decide 2 findings', { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

/** Ticks both findings and opens the bulk Implement form; returns the bulk bar. */
async function openBulkImplement(page: Page): Promise<Locator> {
  for (const title of TO_DECIDE) {
    await page.getByRole('checkbox', { name: `Select finding: ${title}` }).check();
  }
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await bar.getByRole('button', { name: 'Implement…' }).click();
  return bar;
}

/** Raises the PR to level 4 from the form, ticks the agent box and signs the Implement. */
async function implementWithAgent(page: Page, bar: Locator): Promise<void> {
  const agent = bar.getByRole('checkbox', { name: 'Implement with agent' });
  await expect(agent).toBeDisabled();
  await expect(bar).toContainText('Implement with agent needs level 4. This PR is at level 3.');
  await bar.getByRole('button', { name: 'Raise this PR to level 4' }).click();
  await expect(agent).toBeEnabled();
  await agent.check();
  await sign(page, bar.getByRole('combobox', { name: 'Signed by' }), 'Kasia');
  await bar.getByRole('button', { name: 'Implement 2' }).click();
  await expect(bar).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await ensureMember(page, 'Kasia', AUTHOR_LOGIN);
});

test.afterEach(async () => {
  await rm(holdFile(), { force: true });
});

test('a level 3 PR raised to level 4 gets a patch that the team edits, reverts and revises', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openReviewedPr(page, 61);

  const bar = await openBulkImplement(page);
  await implementWithAgent(page, bar);
  await expect(banner(page)).toContainText('Patch ready: 2 of 2 fixed, reproductions pass', {
    timeout: 90_000,
  });

  await page.getByRole('tab', { name: 'Patch' }).click();
  await expect(page.getByTestId('patch-summary')).toHaveText('2 of 2 fixed · reproductions pass');
  await expect(page.getByTestId('patch-diff')).toHaveCount(2);

  // Edit one file by hand.
  const edges = page.getByRole('region', { name: EDGES });
  await edges.getByRole('button', { name: 'Edit' }).click();
  const editor = edges.getByRole('textbox', { name: `Content of ${EDGES}` });
  await editor.fill(
    'export const label = (edge: { name: string; id: string }) => edge.name || edge.id;\n',
  );
  await edges.getByRole('button', { name: 'Save' }).click();
  await expect(edges.getByText('edited by hand')).toBeVisible();

  // Revert the other: it leaves the list.
  await page.getByRole('button', { name: `Revert ${SDK}` }).click();
  await expect(page.getByRole('region', { name: SDK })).toHaveCount(0);
  await expect(page.getByTestId('patch-file')).toHaveCount(1);

  // Revise with a note: the implementer writes revision 2, shown after "View new results".
  const revise = page.getByRole('form', { name: 'Revise with this note' });
  await revise.getByLabel('Note for the implementer').fill('Fall back to the id when trimmed.');
  await revise.getByRole('button', { name: 'Revise with this note' }).click();
  await expect(async () => {
    const view = page.getByRole('button', { name: 'View new results' });
    if (await view.isVisible()) await view.click();
    await expect(page.getByText('Revision 2')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
});

test('Cancel during Fixing leaves no patch', async ({ page }) => {
  test.setTimeout(180_000);
  await openReviewedPr(page, 62);
  await writeFile(holdFile(), '');

  const bar = await openBulkImplement(page);
  await implementWithAgent(page, bar);
  await expect(banner(page)).toContainText('Implementer is fixing 2 findings · started by Kasia', {
    timeout: 60_000,
  });
  await banner(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(banner(page)).toContainText('2 findings to implement', { timeout: 60_000 });

  await page.getByRole('tab', { name: 'Patch' }).click();
  await expect(page.getByText('No patch yet. Implement with agent writes one.')).toBeVisible();
});
