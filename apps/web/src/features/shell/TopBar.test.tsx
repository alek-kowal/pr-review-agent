import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { renderApp } from '@/test/renderApp.tsx';

const NAV_LABELS = [copy.nav.pullRequests, copy.nav.activity, copy.nav.insights, copy.nav.settings];

test('shows the product name and the four nav links', async () => {
  renderApp('/prs');

  const banner = await screen.findByRole('banner');
  expect(within(banner).getByRole('link', { name: copy.app.name })).toHaveAttribute('href', '/prs');

  const nav = within(banner).getByRole('navigation', { name: copy.nav.label });
  const links = within(nav).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual(NAV_LABELS);
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/prs',
    '/activity',
    '/insights',
    '/settings',
  ]);
});

test.each([
  ['/prs', copy.nav.pullRequests],
  ['/activity', copy.nav.activity],
  ['/insights', copy.nav.insights],
  ['/settings', copy.nav.settings],
])('marks %s as the current page', async (path, activeLabel) => {
  renderApp(path);

  const nav = await screen.findByRole('navigation', { name: copy.nav.label });
  await within(nav).findByRole('link', { name: activeLabel, current: 'page' });
  const current = within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current.map((link) => link.textContent)).toEqual([activeLabel]);
});

test('has no account menu', async () => {
  renderApp('/prs');

  const banner = await screen.findByRole('banner');
  expect(within(banner).queryAllByRole('button')).toEqual([]);
  expect(within(banner).queryByRole('menu')).toBeNull();
  expect(within(banner).queryByText(/account|profile|sign out|log out/i)).toBeNull();
});
