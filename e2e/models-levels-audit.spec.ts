// S-21-T8: Settings → Models (FR-075), Review levels (FR-078) and the Audit log (FR-082) on the
// e2e stack. The settings are global, so the spec first puts back what a failed attempt left; the
// level 3 timeout it sets (45 min) is longer than the default, and only GLOBAL_LEVEL_REPOSITORY
// has no level of its own, so specs running beside it see no difference.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { signer, sql, writeHeaders, type TeamMember } from './support/api.ts';
import { GLOBAL_LEVEL_REPOSITORY, VERIFIED_REPOSITORY } from './support/env.ts';
import { deliverPullRequest, stackState } from './support/github.ts';

const OLD_VERIFIER = 'claude-sonnet-5-5';
const NEW_VERIFIER = 'claude-sonnet-5-6';

async function sign(page: Page, dialog: Locator, member: TeamMember): Promise<void> {
  const combobox = dialog.getByRole('combobox', { name: 'Signed by' });
  await combobox.click();
  await page.getByRole('option', { name: member.name }).click();
  await expect(combobox).toContainText(member.name);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}

/** Puts the models, level 3 and the default level back to the stack's start (for a retry). */
async function resetSettings(request: APIRequestContext, member: TeamMember): Promise<void> {
  const { apiUrl } = stackState();
  const models = (await (await request.get(`${apiUrl}/api/settings/models`)).json()) as {
    models: Record<string, string>;
    defaults: Record<string, string>;
  };
  if (models.models.verifier !== models.defaults.verifier) {
    await request.put(`${apiUrl}/api/settings/models`, {
      headers: writeHeaders(),
      data: { models: models.defaults, signedBy: member.id },
    });
  }
  const levels = (await (await request.get(`${apiUrl}/api/settings/levels`)).json()) as {
    defaultLevel: number;
    levels: { number: number; own: Record<string, unknown> }[];
  };
  if (Object.keys(levels.levels[2]?.own ?? {}).length > 0) {
    await request.put(`${apiUrl}/api/settings/levels/3`, {
      headers: writeHeaders(),
      data: { values: {}, signedBy: member.id },
    });
  }
  if (levels.defaultLevel !== 1) {
    await request.put(`${apiUrl}/api/settings/default-level`, {
      headers: writeHeaders(),
      data: { defaultLevel: 1, signedBy: member.id },
    });
  }
}

/** The models the verifier double received in the PR's latest run. */
async function verifierModels(slug: string, number: number): Promise<string[]> {
  const [run] = await sql<{ id: number }>(
    `select r.id from runs r
       join pull_requests p on p.id = r.pull_request_id
       join repositories x on x.id = p.repository_id
      where x.slug = $1 and p.number = $2
      order by r.id desc limit 1`,
    [slug, number],
  );
  if (!run) return [];
  const log = await readFile(stackState().agentCalls, 'utf8').catch(() => '');
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { role: string; model: string; dirs: string[] })
    .filter(
      (call) =>
        call.role === 'verifier' &&
        call.dirs.some((dir) => dir.split(/[\\/]/).includes(`run-${run.id}`)),
    )
    .map((call) => call.model);
}

const setting = (page: Page, key: string) => page.locator(`[data-setting="level-${key}"]`);

test('models, review levels and the audit log', async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const me = await signer(request);
  await resetSettings(request, me);

  await test.step('an invalid model name is rejected with a message', async () => {
    await page.goto('/settings/models');
    await page.getByRole('combobox', { name: 'Verifier model' }).click();
    await page.getByRole('option', { name: 'Other model…' }).click();
    await page.getByRole('textbox', { name: 'Verifier model name' }).fill('--dangerous');
    await expect(page.getByText(/^Not a valid model name\./)).toBeVisible();
    await page.getByRole('button', { name: 'Save…' }).click();
    await expect(page.getByRole('alert')).toContainText('Fix the model names marked below');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  await test.step('the verifier model changes, signed', async () => {
    await page.getByRole('textbox', { name: 'Verifier model name' }).fill(NEW_VERIFIER);
    await page.getByRole('button', { name: 'Save…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Save models' });
    await expect(dialog.getByRole('row', { name: /Verifier/ })).toContainText(
      `${OLD_VERIFIER}${NEW_VERIFIER}`,
    );
    await sign(page, dialog, me);
    await expect(page.getByRole('combobox', { name: 'Verifier model' })).toContainText(
      'Other model…',
    );
    await expect(page.getByRole('textbox', { name: 'Verifier model name' })).toHaveValue(
      NEW_VERIFIER,
    );
  });

  await test.step("the next round's verifier double receives the new model", async () => {
    const number = 61 + testInfo.retry;
    await deliverPullRequest(
      request,
      'ready_for_review',
      number,
      `Verifier model ${number}`,
      VERIFIED_REPOSITORY,
    );
    await expect
      .poll(() => verifierModels(VERIFIED_REPOSITORY.slug, number), { timeout: 150_000 })
      .toContain(NEW_VERIFIER);
    expect(new Set(await verifierModels(VERIFIED_REPOSITORY.slug, number))).toEqual(
      new Set([NEW_VERIFIER]),
    );
  });

  await test.step("level 3's own review timeout shows as inherited on level 4", async () => {
    await page.goto('/settings/review-levels/3');
    const timeout = setting(page, 'stageTimeoutMinutes');
    await timeout.getByRole('radio', { name: 'Own value' }).click();
    await timeout.getByRole('textbox', { name: 'Review timeout' }).fill('45');
    await page.getByRole('button', { name: 'Save…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Save level 3' });
    await expect(dialog.getByRole('row', { name: /Review timeout/ })).toContainText('Inherited45');
    await sign(page, dialog, me);

    await page.getByRole('link', { name: 'Level 4' }).click();
    await expect(page.getByRole('heading', { name: /^Level 4/, level: 1 })).toBeVisible();
    const inherited = setting(page, 'stageTimeoutMinutes');
    await expect(inherited).toContainText('45 min · from level 3');
    await expect(inherited.getByRole('radio', { name: 'Inherited' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  await test.step('with default level 2, a repository without its own level starts at 2', async () => {
    await page.goto('/settings/review-levels');
    await page
      .getByRole('combobox', { name: 'Default for repositories without their own' })
      .click();
    await page.getByRole('option', { name: '2 · With context' }).click();
    await page.getByRole('button', { name: 'Save…' }).click();
    await sign(page, page.getByRole('alertdialog', { name: 'Change the default level' }), me);
    const ladder = page.getByRole('list', { name: 'Review levels 1 to 6' });
    await expect(ladder.getByRole('link').nth(1)).toContainText('Default');

    const number = 71 + testInfo.retry;
    await deliverPullRequest(
      request,
      'ready_for_review',
      number,
      `Global default level ${number}`,
      GLOBAL_LEVEL_REPOSITORY,
    );
    const { apiUrl } = stackState();
    await expect
      .poll(
        async () => {
          const view = await request.get(
            `${apiUrl}/api/prs/${GLOBAL_LEVEL_REPOSITORY.slug}/${number}`,
          );
          if (!view.ok()) return null;
          const body = (await view.json()) as { latestRound: { level: { number: number } } | null };
          return body.latestRound?.level.number ?? null;
        },
        { timeout: 60_000 },
      )
      .toBe(2);
  });

  await test.step('the Audit log finds the verifier change with before, after and the signer', async () => {
    await page.goto('/settings/audit');
    await page.getByRole('searchbox', { name: 'Search' }).fill('verifier');
    await expect(page).toHaveURL(/[?&]q=verifier/);
    const table = page.getByRole('table', { name: 'Settings changes' });
    const row = table
      .getByRole('row')
      .filter({ hasText: me.name })
      .filter({ hasText: 'Changed verifier' })
      .first();
    await expect(row).toContainText('Models');
    await row.getByRole('button', { name: 'Show before and after' }).click();
    const details = table.locator('[data-details]').first();
    await expect(details.locator('figure').filter({ hasText: 'Before' })).toContainText(
      `"verifier": "${OLD_VERIFIER}"`,
    );
    await expect(details.locator('figure').filter({ hasText: 'After' })).toContainText(
      `"verifier": "${NEW_VERIFIER}"`,
    );
  });
});
