import { expect, test } from '@playwright/test';

test('opens on the pull requests page with the top bar', async ({ page }) => {
  // No api in this spec: answer the list's reads here, so it never reaches another worktree's api.
  await page.route('**/api/repositories', (route) => route.fulfill({ json: { repositories: [] } }));
  await page.route('**/api/prs', (route) => route.fulfill({ json: { pullRequests: [] } }));
  await page.goto('/');

  await expect(page).toHaveURL(/\/prs$/);
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
  await expect(page.getByText('No open pull requests.')).toBeVisible();
});
