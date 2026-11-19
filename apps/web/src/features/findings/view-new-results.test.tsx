// S-08-T8: a newer round's results wait behind "View new results"; the banner does not wait.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { aFinding, aFindingsResponse, aNextStep, aPrView, aRound } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const round1 = aFindingsResponse({
  round: { id: 1, number: 1, level: { number: 1, key: 'review' }, finishedAt: null },
  findings: [
    aFinding({ id: 11, severity: 'blocking', title: 'Undo loses the group' }),
    aFinding({ id: 12, severity: 'blocking', title: 'Drag ignores the snap grid' }),
  ],
});
const round2 = aFindingsResponse({
  round: { id: 2, number: 2, level: { number: 1, key: 'review' }, finishedAt: null },
  findings: [aFinding({ id: 21, severity: 'blocking', title: 'Labels overflow the node' })],
});

test('after a new round the banner changes at once; the findings switch only on click', async () => {
  const routes: Record<string, unknown> = {
    '/api/prs/wb/12': aPrView({ round: aRound({ id: 1, status: 'completed' }) }),
    '/api/prs/wb/12/findings': round1,
    '/api/team': { members: [] },
  };
  stubFetch(routes);
  const user = userEvent.setup();
  const { queryClient } = renderApp('/pr/wb/12');

  await screen.findByRole('article', { name: /Undo loses the group/ });
  // A selection the reader made stays while the new results wait.
  await user.click(screen.getByRole('checkbox', { name: /Undo loses the group/ }));
  expect(screen.queryByRole('heading', { name: '2 findings to implement' })).toBeNull();

  // Round 2 finished: the live event (or a refetch) brings the new PR view and findings.
  routes['/api/prs/wb/12'] = aPrView({
    round: aRound({ id: 2, number: 2, status: 'completed' }),
    nextStep: aNextStep({
      state: 'waiting_for_fix',
      banner: { code: 'state_waiting_for_fix', params: { count: 2 } },
    }),
  });
  routes['/api/prs/wb/12/findings'] = round2;
  await act(() => queryClient.invalidateQueries({ queryKey: ['pr', 'wb', '12'] }));

  expect(await screen.findByRole('heading', { name: '2 findings to implement' })).toBeVisible();
  const strip = await screen.findByTestId('new-results');
  expect(strip).toHaveTextContent(/New results from round 2\s*·\s*View new results/);
  expect(screen.getByRole('article', { name: /Undo loses the group/ })).toBeVisible();
  expect(screen.queryByRole('article', { name: /Labels overflow the node/ })).toBeNull();
  expect(screen.getByRole('region', { name: copy.decisions.bulk.label })).toHaveTextContent(
    '1 selected',
  );

  await user.click(within(strip).getByRole('button', { name: copy.findings.viewNewResults }));
  expect(screen.getByRole('article', { name: /Labels overflow the node/ })).toBeVisible();
  expect(screen.queryByRole('article', { name: /Undo loses the group/ })).toBeNull();
  await waitFor(() => expect(screen.queryByTestId('new-results')).toBeNull());
});

test('changes within the shown round appear at once', async () => {
  const routes: Record<string, unknown> = {
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': round1,
    '/api/team': { members: [] },
  };
  stubFetch(routes);
  const { queryClient } = renderApp('/pr/wb/12');
  await screen.findByRole('article', { name: /Undo loses the group/ });

  routes['/api/prs/wb/12/findings'] = {
    ...round1,
    findings: [round1.findings[0], { ...round1.findings[1]!, title: 'Drag skips the grid' }],
  };
  await act(() => queryClient.invalidateQueries({ queryKey: ['pr', 'wb', '12'] }));

  expect(await screen.findByRole('article', { name: /Drag skips the grid/ })).toBeVisible();
  expect(screen.queryByTestId('new-results')).toBeNull();
});
