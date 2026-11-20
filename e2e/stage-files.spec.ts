// STAGEFILES: pick another rules file for Verify on one repository and see it used. The spec
// creates a global rules file with New file, makes v1 active (signed), picks it for Verify on
// `STAGE_FILES_REPOSITORY` (level 3) in Settings → Pipeline (signed), and delivers a PR. Run
// detail lists the file as read by Verify, the verifier double keeps the rules it received (a
// hold file, written when they carry `STAGE_FILES_MARK`), and Settings → Instructions lists Verify
// for the repository among the file's readers.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signer, sql, type TeamMember } from './support/api.ts';
import {
  STAGE_FILES_MARK,
  STAGE_FILES_PRS,
  STAGE_FILES_REPOSITORY,
  verifyRulesFile,
} from './support/env.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

const REPOSITORY = STAGE_FILES_REPOSITORY;
const { slug } = REPOSITORY;

async function sign(page: Page, dialog: Locator, member: TeamMember, confirm: string) {
  const combobox = dialog.getByRole('combobox', { name: 'Signed by' });
  await combobox.click();
  await page.getByRole('option', { name: member.name }).click();
  await expect(combobox).toContainText(member.name);
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

/** The PR's completed round, once there is one. */
async function completedRound(number: number): Promise<number> {
  let id = 0;
  await expect
    .poll(
      async () => {
        const [row] = await sql<{ id: number }>(
          `select r.id from runs r
             join pull_requests p on p.id = r.pull_request_id
             join repositories o on o.id = p.repository_id
            where o.slug = $1 and p.number = $2 and r.kind = 'round' and r.status = 'completed'
            order by r.id desc limit 1`,
          [slug, number],
        );
        id = row?.id ?? 0;
        return id;
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);
  return id;
}

test('a rules file picked for Verify on one repository is the one its round reads', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  // A retry shares the stack's database: a new PR and a new file the earlier attempt never made.
  const number = STAGE_FILES_PRS.from + testInfo.retry;
  const fileKey = `verify-rules-e2e-${testInfo.retry}.md`;
  const rules = `Refute a finding only when the script shows it is wrong.\n\n${STAGE_FILES_MARK}${number}`;
  const me = await signer(request);

  // New file: a global instruction whose version 1 starts as a draft; the editor opens on it.
  await page.goto('/settings/instructions');
  await page.getByRole('button', { name: 'New file' }).click();
  const create = page.getByRole('dialog', { name: 'New instruction file' });
  await create.getByRole('textbox', { name: 'File name' }).fill(fileKey);
  await create.getByRole('textbox', { name: 'First version' }).fill(rules);
  await create.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/settings\/instructions\/\d+$/);
  await expect(page.getByRole('heading', { name: fileKey })).toBeVisible();

  // Make v1 active from the version history, signed.
  await page.getByRole('button', { name: 'Make v1 active…' }).click();
  await sign(
    page,
    page.getByRole('alertdialog', { name: 'Make version 1 active?' }),
    me,
    'Make active',
  );

  // Settings → Pipeline for the repository: Verify reads the new file instead of the global rules.
  await page.goto(`/settings/pipeline?repository=${slug}`);
  await page.getByRole('button', { name: 'Verify, from level 3' }).click();
  const sheet = page.getByRole('dialog', { name: 'Verify' });
  await sheet.getByRole('combobox', { name: 'Verify rules file' }).click();
  await page.getByRole('option', { name: fileKey, exact: true }).click();
  await expect(sheet.getByRole('group', { name: 'Rules' })).toContainText(
    'Overridden for this repository',
  );
  await sheet.getByRole('button', { name: 'Save…' }).click();
  await sign(page, page.getByRole('alertdialog'), me, 'Save changes');
  await expect(sheet.getByRole('status')).toHaveText(
    'Saved. Runs that start now read these files.',
  );

  // A PR on the repository: its round freezes the choice, and Verify reads the new rules.
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `Stage files ${number}`,
    REPOSITORY,
  );
  const runId = await completedRound(number);
  await page.goto(`/runs/${runId}`);
  const versions = page.locator('section', {
    has: page.getByRole('heading', { name: 'Instruction versions' }),
  });
  await expect(versions.getByRole('listitem').filter({ hasText: fileKey })).toContainText(
    'Read by Verify',
  );
  const held = verifyRulesFile(stackState().holdDir, String(number));
  // The stored text may end with a newline the form did not send.
  await expect
    .poll(async () => (await readFile(held, 'utf8').catch(() => '')).trim(), { timeout: 30_000 })
    .toBe(rules);

  // Settings → Instructions: the file is read by Verify for this repository only.
  await page.goto('/settings/instructions');
  const row = page
    .getByRole('region', { name: 'Instructions' })
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: fileKey, exact: true }) });
  await expect(row).toContainText(`Verify (${slug})`);
});
