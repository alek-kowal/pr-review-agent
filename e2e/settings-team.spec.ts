import { expect, test, type Route } from '@playwright/test';

type Member = { id: string; name: string; githubLogin: string; clickupUserId: string | null };

test('the first person adds themselves, then signs adding the next one', async ({ page }) => {
  // No api in this spec: Team lives here, so it never reaches another worktree's api.
  const members: Member[] = [];
  const posted: unknown[] = [];
  await page.route('**/api/team', async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Omit<Member, 'id'> & { signedBy?: string };
      posted.push(body);
      const member: Member = {
        id: `m-${members.length + 1}`,
        name: body.name,
        githubLogin: body.githubLogin,
        clickupUserId: body.clickupUserId,
      };
      members.push(member);
      return route.fulfill({ status: 201, json: { member } });
    }
    return route.fulfill({ json: { members } });
  });

  await page.goto('/settings/team');
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
  await expect(page.getByText('Nobody is in Team yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Add a person' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add a person to Team' });
  await expect(dialog.getByText('you sign as yourself')).toBeVisible();
  await dialog.getByLabel('Name').fill('Kasia');
  await dialog.getByLabel('GitHub login').fill('kasia');
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('table', { name: 'Team members' })).toContainText('@kasia');

  await page.getByRole('button', { name: 'Add a person' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a person to Team' });
  await dialog.getByLabel('Name').fill('Tomek');
  await dialog.getByLabel('GitHub login').fill('tomek');
  await dialog.getByRole('combobox', { name: 'Signed by' }).click();
  await page.getByRole('option', { name: /Kasia/ }).click();
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('table', { name: 'Team members' })).toContainText('@tomek');
  expect(posted).toEqual([
    { name: 'Kasia', githubLogin: 'kasia', clickupUserId: null },
    { name: 'Tomek', githubLogin: 'tomek', clickupUserId: null, signedBy: 'm-1' },
  ]);
});
