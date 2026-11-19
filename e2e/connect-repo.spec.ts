// S-20-T8 (US-16): a second repository connected in Settings alone gets its own rounds, with the
// GitHubGateway double. The stack's fixture PR adds `db/migrations/0001_edge_labels.sql`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { SECOND_REPOSITORY } from './support/env.ts';
import { AUTHOR_LOGIN, deliverPullRequest, stackState } from './support/github.ts';

const SECOND = SECOND_REPOSITORY.fullName;
const WB = 'synergycodes/workflowbuilder';

async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: stackState().databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Kasia signs. She is the same person decide.spec.ts adds through Team, so whichever spec comes
 * first, Team ends up with one Kasia.
 */
const ensureKasia = () =>
  query(
    `insert into team_members (name, github_login) values ('Kasia', $1) on conflict do nothing`,
    [AUTHOR_LOGIN],
  );

async function sign(page: Page, scope: Locator): Promise<void> {
  const combobox = scope.getByRole('combobox', { name: 'Signed by' });
  await combobox.click();
  await page.getByRole('option', { name: /Kasia/ }).click();
  await expect(combobox).toContainText('Kasia');
}

async function connectSecondRepository(page: Page): Promise<void> {
  await page.goto('/settings/repositories');
  const table = page.getByRole('table', { name: 'Connected repositories' });
  await expect(table).toContainText(WB);
  // A retry finds it connected already.
  if ((await table.getByRole('link', { name: SECOND, exact: true }).count()) > 0) return;

  await page.getByRole('combobox', { name: 'Connect a repository' }).click();
  await page.getByRole('option', { name: new RegExp(SECOND) }).click();
  await expect(page.getByRole('heading', { name: `Connect ${SECOND}`, level: 1 })).toBeVisible();

  await page.getByLabel('Default review level').click();
  await page.getByRole('option', { name: '2 · With context' }).click();
  await page.getByLabel('Default branch').fill('develop');
  await page.getByRole('button', { name: 'Add a pattern' }).click();
  const sensitive = page.getByRole('table', { name: 'Sensitive file patterns' });
  await sensitive.getByRole('textbox', { name: 'Path pattern' }).fill('db/migrations/**');
  await sensitive
    .getByRole('textbox', { name: 'Reason shown to people' })
    .fill('Schema changes reach every environment.');
  await expect(
    page.getByRole('switch', { name: 'Use ClickUp for this repository' }),
  ).not.toBeChecked();

  await page.getByRole('button', { name: 'Connect…' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Connect ${SECOND}` });
  await expect(dialog.getByRole('row', { name: /Default review level/ })).toContainText(
    '2 · With context',
  );
  await expect(dialog.getByRole('row', { name: /Use ClickUp/ })).toContainText('Off');
  await sign(page, dialog);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/repositories\/\d+$/);
  await expect(page.getByRole('heading', { name: SECOND, level: 1 })).toBeVisible();
}

test('a second repository connected in Settings gets its own rounds', async ({
  page,
  request,
}, testInfo) => {
  await ensureKasia();

  // 1. Connect acme/second-repo: level 2, branch develop, one sensitive pattern, ClickUp off.
  await connectSecondRepository(page);
  const [stored] = await query<{ config: Record<string, unknown> }>(
    'select config from repositories where github_full_name = $1',
    [SECOND],
  );
  expect(stored?.config).toMatchObject({
    defaultLevel: 2,
    defaultBranch: 'develop',
    clickup: null,
    sensitivePatterns: [{ pattern: 'db/migrations/**' }],
  });
  const actor = await query<{ count: number }>(
    `select count(*)::int as count from settings_changes
      where area = 'repositories' and after->>'githubFullName' = $1 and signer_id is not null`,
    [SECOND],
  );
  expect(actor[0]?.count).toBe(1);

  // 2. ready_for_review for acme/second-repo#12: the board shows it with its repository.
  const number = 12 + testInfo.retry;
  const title = `Add edge label migration ${number}`;
  await deliverPullRequest(request, 'ready_for_review', number, title, SECOND_REPOSITORY);
  await expect(async () => {
    await page.goto('/prs');
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const card = page.getByRole('article').filter({ has: page.getByRole('link', { name: title }) });
  await expect(card).toContainText('second-repo');

  // 3. Round 1 runs at level 2: Checks, Task (ClickUp off), Change type and Review; Verify off.
  await page.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`/pr/second-repo/${number}$`));
  await expect(page.getByRole('region', { name: 'Blocking' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Unchecked (level 2)').first()).toBeVisible();
  const view = await request.get(`${stackState().apiUrl}/api/prs/second-repo/${number}`);
  const { latestRound } = (await view.json()) as {
    latestRound: {
      status: string;
      level: { number: number };
      stages: { key: string; status: string }[];
    };
  };
  expect(latestRound.level.number).toBe(2);
  expect(latestRound.status).toBe('completed');
  expect(Object.fromEntries(latestRound.stages.map((s) => [s.key, s.status]))).toEqual({
    checks: 'succeeded',
    task: 'succeeded',
    change_type: 'succeeded',
    review: 'succeeded',
    verify: 'off',
  });

  // 4. The sensitive-file rule applies to this repository only: its change type is a one-way
  // door for the migration; Workflow Builder has no such pattern.
  const [changeType] = await query<{ output: { changeType: string; rules: unknown } }>(
    `select s.output from stage_executions s
       join runs r on r.id = s.run_id
       join pull_requests p on p.id = r.pull_request_id
       join repositories repo on repo.id = p.repository_id
      where repo.github_full_name = $1 and p.number = $2 and s.stage = 'change_type'`,
    [SECOND, number],
  );
  expect(changeType?.output).toMatchObject({
    changeType: 'one_way_door',
    rules: { changeType: 'one_way_door', reason: { code: 'sensitive_one_way' } },
  });
  await page.goto('/settings/repositories');
  const list = page.getByRole('table', { name: 'Connected repositories' });
  await expect(list.getByRole('row').filter({ hasText: SECOND })).toContainText('1 pattern');
  await expect(list.getByRole('row').filter({ hasText: WB })).toContainText('0 patterns');

  // 5. Integrations lists both repositories and a recent delivery.
  await page.goto('/settings/integrations');
  const github = page.getByRole('region', { name: 'GitHub App' });
  await expect(github).toContainText('Connected');
  await expect(github).toContainText(WB);
  await expect(github).toContainText(SECOND);
  await expect(github).not.toContainText('No delivery yet');
  await expect(github).toContainText(/\d+ deliver(y|ies) in 24 h/);
});
