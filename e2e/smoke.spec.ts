import { expect, test } from '@playwright/test';

test('opens on the pull requests page with the top bar', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/prs$/);
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
});
