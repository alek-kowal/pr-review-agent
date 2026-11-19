import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const stubPr = () =>
  stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse(),
  });

test('shows the title, one grey line and the tabs, Findings first', async () => {
  stubPr();
  renderApp('/pr/wb/12');

  expect(await screen.findByRole('heading', { name: /Add node grouping/ })).toBeInTheDocument();
  expect(screen.getByTestId('pr-meta')).toHaveTextContent('feature/grouping → main');
  const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
  expect(tabs).toEqual(['Findings', 'Questions', 'Patch', 'Timeline']);
  expect(screen.getByRole('tab', { name: copy.pr.tabs.findings })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('switching tabs updates ?tab=', async () => {
  stubPr();
  const user = userEvent.setup();
  const { router } = renderApp('/pr/wb/12');

  await user.click(await screen.findByRole('tab', { name: copy.pr.tabs.questions }));

  await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'questions' }));
  expect(screen.getByRole('tab', { name: copy.pr.tabs.questions })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByText(copy.pr.empty.questions)).toBeVisible();
});

test('a deep link opens the right tab', async () => {
  stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/prs/wb/12/timeline': {
      summary: {
        readyAt: null,
        outcome: 'open',
        totalMs: 0,
        agentsWorkedMs: 0,
        waitingMs: 0,
        byLane: {},
        costUsd: 0,
      },
      entries: [],
    },
  });
  renderApp('/pr/wb/12?tab=timeline');

  const tab = await screen.findByRole('tab', { name: copy.pr.tabs.timeline });
  expect(tab).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText(copy.timeline.empty)).toBeVisible();
});

test('an unknown ?tab= falls back to Findings', async () => {
  stubPr();
  renderApp('/pr/wb/12?tab=nope');

  const tab = await screen.findByRole('tab', { name: copy.pr.tabs.findings });
  expect(tab).toHaveAttribute('aria-selected', 'true');
});

test('an unknown PR shows the not-found copy', async () => {
  stubFetch({
    '/api/prs/wb/99': { status: 404, body: { error: { code: 'pr_not_found', params: {} } } },
  });
  renderApp('/pr/wb/99');

  expect(await screen.findByRole('heading', { name: copy.pr.notFound })).toBeInTheDocument();
});
