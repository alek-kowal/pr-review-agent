import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import type { OverviewPr, OverviewResponse } from './types.ts';

afterEach(restoreFetch);

const HOUR = 3_600_000;

const aPr = (n: number, patch: Partial<OverviewPr> = {}): OverviewPr => ({
  repository: 'wb',
  number: n,
  title: `PR ${n}`,
  author: 'ola',
  outcome: 'merged',
  finishedAt: '2026-11-18T10:00:00.000Z',
  readyToMergeMs: 3 * HOUR,
  lanes: { agentsWorking: HOUR / 2, actionNeeded: 1.5 * HOUR, readyToMerge: HOUR },
  agentWorkMs: 10 * 60_000,
  costUsd: 0.5,
  rounds: 1,
  chainUsedUp: false,
  changedAfterReady: false,
  ignoredBaseMerges: 0,
  ...patch,
});

function anOverview(n: number): OverviewResponse {
  const sample = { sampleSize: n, tooFew: n < 10 };
  return {
    range: 30,
    since: '2026-10-20T10:00:00.000Z',
    authors: ['kuba', 'ola'],
    metrics: {
      agentWork: { valueMs: 10 * 60_000, ...sample },
      readyToMerge: {
        valueMs: 3 * HOUR,
        ...sample,
        lanes: { agentsWorking: n * HOUR, actionNeeded: n * 2 * HOUR, readyToMerge: n * HOUR },
      },
      cost: { valueUsd: 0.5, ...sample, tokens: 1000, trialCostUsd: 2, analystCostUsd: 1.5 },
      roundsUsedUp: { count: 1, ...sample, overThreeRounds: 0 },
      changedAfterReady: { count: 2, ...sample, ignoredBaseMerges: 1 },
    },
    prs: Array.from({ length: n }, (_, i) => aPr(i + 1)),
  };
}

const repositories = {
  repositories: [
    { slug: 'wb', name: 'workflowbuilder', githubFullName: 'acme/wb' },
    { slug: 'tpl', name: 'templates', githubFullName: 'acme/tpl' },
  ],
};

const tiles = async () =>
  within(
    await screen.findByRole('list', { name: copy.insights.overview.metricsLabel }),
  ).getAllByRole('listitem');

test('every tile shows its sample size; the lane split has three values', async () => {
  stubFetch({
    '/api/insights/overview?range=30': anOverview(17),
    '/api/repositories': repositories,
  });
  renderApp('/insights');
  const all = await tiles();
  expect(all).toHaveLength(5);
  for (const tile of all) {
    expect(tile).toHaveTextContent('Based on 17 PRs merged');
    expect(tile).not.toHaveTextContent(copy.insights.overview.tooFew);
  }
  const lanes = screen.getByRole('region', { name: copy.insights.overview.lanes.title });
  expect(
    within(lanes)
      .getAllByRole('definition')
      .map((dd) => dd.textContent),
  ).toEqual(['25% 17 h', '50% 34 h', '25% 17 h']);
  // No trend or delta anywhere.
  expect(document.body.textContent).not.toMatch(/[+-]\d+%|better|worse|trend/i);
});

test('9 PRs are too few for firm conclusions', async () => {
  stubFetch({
    '/api/insights/overview?range=30': anOverview(9),
    '/api/repositories': repositories,
  });
  renderApp('/insights');
  for (const tile of await tiles()) {
    expect(tile).toHaveTextContent(`Based on 9 PRs merged · ${copy.insights.overview.tooFew}`);
  }
});

test('a sample with closed PRs says so on the metrics over every finished PR', async () => {
  const body = anOverview(12);
  body.prs[0] = aPr(1, { outcome: 'closed', readyToMergeMs: null, lanes: null });
  stubFetch({ '/api/insights/overview?range=30': body, '/api/repositories': repositories });
  renderApp('/insights');
  const [agentWork, readyToMerge] = await tiles();
  expect(agentWork).toHaveTextContent('Based on 12 PRs merged or closed');
  expect(readyToMerge).toHaveTextContent('Based on 12 PRs merged');
  expect(readyToMerge).not.toHaveTextContent('merged or closed');
});

test('filters round-trip through the URL', async () => {
  const user = userEvent.setup();
  const { calls } = stubFetch({
    '/api/insights/overview?range=14&repo=wb&author=ola': anOverview(5),
    '/api/insights/overview?range=30&repo=wb&author=ola': anOverview(6),
    '/api/insights/overview?range=30&repo=wb&author=kuba': anOverview(7),
    '/api/insights/overview?range=30&author=kuba': anOverview(8),
    '/api/repositories': repositories,
  });
  const { router } = renderApp('/insights?range=14&repo=wb&author=ola');
  await tiles();
  const range = screen.getByRole('group', { name: copy.insights.filters.range });
  expect(within(range).getByRole('button', { name: 'Last 14 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('combobox', { name: copy.insights.filters.author })).toHaveTextContent(
    'ola',
  );
  expect(screen.getByRole('combobox', { name: copy.insights.filters.repo })).toHaveTextContent(
    'wb',
  );

  await user.click(within(range).getByRole('button', { name: 'Last 30 days' }));
  await waitFor(() => expect(router.state.location.search).toEqual({ repo: 'wb', author: 'ola' }));

  await user.click(screen.getByRole('combobox', { name: copy.insights.filters.author }));
  await user.click(await screen.findByRole('option', { name: 'kuba' }));
  await waitFor(() => expect(router.state.location.search).toEqual({ repo: 'wb', author: 'kuba' }));

  await user.click(screen.getByRole('combobox', { name: copy.insights.filters.repo }));
  await user.click(await screen.findByRole('option', { name: copy.insights.filters.allRepos }));
  await waitFor(() => expect(router.state.location.search).toEqual({ author: 'kuba' }));
  await waitFor(() =>
    expect(calls.map((call) => call.path)).toContain('/api/insights/overview?range=30&author=kuba'),
  );
  expect((await tiles())[0]).toHaveTextContent('Based on 8 PRs merged');
});

test('the PR table and "Not measured yet" start collapsed', async () => {
  const user = userEvent.setup();
  stubFetch({
    '/api/insights/overview?range=30': anOverview(17),
    '/api/repositories': repositories,
  });
  renderApp('/insights');
  await tiles();
  const table = screen.getByText(copy.insights.overview.table.title(17)).closest('details')!;
  const later = screen.getByText(copy.insights.overview.notMeasured.title).closest('details')!;
  expect(table).not.toHaveAttribute('open');
  expect(later).not.toHaveAttribute('open');
  await user.click(screen.getByText(copy.insights.overview.notMeasured.title));
  expect(later).toHaveAttribute('open');
  expect(within(later).getAllByRole('listitem')).toHaveLength(3);
});
