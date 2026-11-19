import { screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

test('/ redirects to /prs', async () => {
  stubFetch({ '/api/repositories': { repositories: [] }, '/api/prs': { pullRequests: [] } });
  const { router } = renderApp('/');

  expect(await screen.findByRole('heading', { name: copy.prs.title })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/prs');
});
