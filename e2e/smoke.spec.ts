import { expect, test } from '@playwright/test';

test('opens on the pull requests page with the top bar', async ({ page }) => {
  // No api in this spec: answer the board's read here, so it never reaches another worktree's api.
  const lane = { cards: [] };
  const board = {
    lanes: {
      not_reviewed: { ...lane, drafts: [] },
      agents_working: lane,
      action_needed: lane,
      ready_to_merge: lane,
    },
    mergedOrClosed: [],
    repositoryCount: 0,
  };
  // The board asks for `?forks=hide` by default.
  await page.route(/\/api\/board(\?|$)/, (route) => route.fulfill({ json: board }));
  await page.goto('/');

  await expect(page).toHaveURL(/\/prs$/);
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Pull requests', level: 1 })).toBeVisible();
  await expect(page.getByText('Nothing needs a person right now.')).toBeVisible();
});
