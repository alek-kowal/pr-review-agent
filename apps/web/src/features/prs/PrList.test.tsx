import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { aPrListItem, aRepository } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const wb = aRepository();
const other = aRepository({ slug: 'other', name: 'Other app', githubFullName: 'acme/other' });
const wbPr = aPrListItem({ number: 12, title: 'Add node grouping' });
const otherPr = aPrListItem({ repository: { slug: 'other' }, number: 7, title: 'Fix login' });

test('shows each PR as repo#number with its title, author and round status', async () => {
  stubFetch({
    '/api/repositories': { repositories: [wb] },
    '/api/prs': { pullRequests: [wbPr, { ...otherPr, latestRoundStatus: null }] },
  });
  renderApp('/prs');

  const list = await screen.findByRole('list', { name: copy.prs.listLabel });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('wb#12');
  expect(rows[0]).toHaveTextContent('Add node grouping');
  expect(rows[0]).toHaveTextContent('octocat');
  expect(rows[0]).toHaveTextContent(copy.prs.roundStatus.completed);
  expect(rows[1]).toHaveTextContent('other#7');
  expect(rows[1]).toHaveTextContent(copy.prs.roundStatus.none);
  expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/pr/wb/12');
});

test('has no repository filter when only one repository exists', async () => {
  stubFetch({ '/api/repositories': { repositories: [wb] }, '/api/prs': { pullRequests: [wbPr] } });
  renderApp('/prs');

  await screen.findByRole('list', { name: copy.prs.listLabel });
  expect(screen.queryByRole('combobox', { name: copy.prs.repositoryFilter })).toBeNull();
});

test('the repository filter writes ?repo= and lists that repository only', async () => {
  const { calls } = stubFetch({
    '/api/repositories': { repositories: [wb, other] },
    '/api/prs': { pullRequests: [wbPr, otherPr] },
    '/api/prs?repo=other': { pullRequests: [otherPr] },
  });
  const user = userEvent.setup();
  const { router } = renderApp('/prs');

  await user.click(await screen.findByRole('combobox', { name: copy.prs.repositoryFilter }));
  await user.click(await screen.findByRole('option', { name: 'Other app' }));

  await waitFor(() => expect(router.state.location.search).toEqual({ repo: 'other' }));
  const list = await screen.findByRole('list', { name: copy.prs.listLabel });
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
  expect(list).toHaveTextContent('other#7');
  expect(calls.map((c) => c.path)).toContain('/api/prs?repo=other');
});

test('a ?repo= deep link filters the list', async () => {
  stubFetch({
    '/api/repositories': { repositories: [wb, other] },
    '/api/prs?repo=other': { pullRequests: [otherPr] },
  });
  renderApp('/prs?repo=other');

  const list = await screen.findByRole('list', { name: copy.prs.listLabel });
  expect(list).toHaveTextContent('other#7');
  expect(screen.getByRole('combobox', { name: copy.prs.repositoryFilter })).toHaveTextContent(
    'Other app',
  );
});

test('shows the error copy when the api cannot be reached', async () => {
  stubFetch({ '/api/repositories': { repositories: [] } });
  renderApp('/prs');

  expect(await screen.findByRole('heading', { name: copy.prs.title })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.unknownError('not_stubbed'));
});
