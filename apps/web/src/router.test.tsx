import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { copy } from './copy/index.ts';
import { createAppRouter } from './router.ts';

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ queryClient, history });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

test('/ redirects to /prs', async () => {
  const router = renderAt('/');

  expect(await screen.findByRole('heading', { name: copy.prs.title })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/prs');
});
