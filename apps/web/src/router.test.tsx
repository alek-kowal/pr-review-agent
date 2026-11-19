import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { renderApp } from '@/test/renderApp.tsx';

test('/ redirects to /prs', async () => {
  const { router } = renderApp('/');

  expect(await screen.findByRole('heading', { name: copy.prs.title })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/prs');
});
