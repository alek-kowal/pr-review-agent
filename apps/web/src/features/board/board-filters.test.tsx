// S-17-T4: the board filters live in the page address. FORKS: fork PRs are hidden by default.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { anEmptyBoard } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const t = copy.board.filters;
const board = anEmptyBoard({ repositoryCount: 2, repositories: ['docs', 'wb'] });
const team = {
  members: [
    { id: 'm-1', name: 'Kasia', githubLogin: 'kasia', clickupUserId: null },
    { id: 'm-2', name: 'Tomek', githubLogin: 'tomek', clickupUserId: null },
  ],
};

/** Stubs the default board request (`forks=hide`), the unfiltered one and the given queries. */
function stub(...queries: string[]) {
  return stubFetch({
    '/api/team': team,
    '/api/board': board,
    '/api/board?forks=hide': board,
    ...Object.fromEntries(queries.map((q) => [`/api/board?${q}`, board])),
  });
}

const personBox = () => screen.findByRole('combobox', { name: t.person });

async function openPanel() {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${t.button}`) }));
  return screen.findByRole('dialog', { name: t.panelLabel });
}

const search = (router: ReturnType<typeof renderApp>['router']) => router.state.location.search;
const paths = (calls: { path: string }[]) => calls.map((c) => c.path);

test('choosing a filter updates the search params and the board request', async () => {
  const { calls } = stub(
    'person=kasia&forks=hide',
    'person=kasia&forks=hide&level=3',
    'person=kasia&forks=hide&level=3&drafts=hide',
  );
  const { router } = renderApp('/prs');

  await userEvent.click(await personBox());
  await userEvent.click(await screen.findByRole('option', { name: /Kasia/ }));
  await waitFor(() => expect(search(router)).toEqual({ person: 'kasia' }));
  expect(await personBox()).toHaveTextContent('Kasia');

  const panel = await openPanel();
  await userEvent.selectOptions(within(panel).getByLabelText(t.level), '3');
  await waitFor(() => expect(search(router)).toEqual({ person: 'kasia', level: 3 }));
  await userEvent.click(within(panel).getByRole('checkbox', { name: t.hideDrafts }));
  await waitFor(() =>
    expect(search(router)).toEqual({ person: 'kasia', level: 3, drafts: 'hide' }),
  );
  expect(router.state.location.href).toBe('/prs?person=kasia&level=3&drafts=hide');
  await waitFor(() =>
    expect(paths(calls)).toContain('/api/board?person=kasia&forks=hide&level=3&drafts=hide'),
  );
});

test('loading a URL with params preselects them', async () => {
  const { calls } = stub('person=kasia&repo=docs&forks=only&level=3&drafts=hide');
  renderApp('/prs?person=kasia&repo=docs&forks=only&level=3&drafts=hide');

  await waitFor(() =>
    expect(paths(calls)).toContain(
      '/api/board?person=kasia&repo=docs&forks=only&level=3&drafts=hide',
    ),
  );
  await waitFor(async () => expect(await personBox()).toHaveTextContent('Kasia'));
  const button = screen.getByRole('button', { name: t.buttonCount(4) });
  expect(button).toBeInTheDocument();
  const panel = await openPanel();
  expect(within(panel).getByLabelText(t.repository)).toHaveValue('docs');
  expect(within(panel).getByLabelText(t.forks)).toHaveValue('only');
  expect(within(panel).getByLabelText(t.level)).toHaveValue('3');
  expect(within(panel).getByRole('checkbox', { name: t.hideDrafts })).toBeChecked();
});

test('an invalid value in the address is dropped', async () => {
  const { calls } = stub('forks=only');
  const { router } = renderApp('/prs?forks=only&level=9&drafts=show');
  await waitFor(() => expect(paths(calls)).toContain('/api/board?forks=only'));
  expect(search(router)).toEqual({ forks: 'only' });
});

test('forks are hidden by default, and the default is not a set filter', async () => {
  const { calls } = stub();
  const { router } = renderApp('/prs');

  await waitFor(() => expect(paths(calls)).toContain('/api/board?forks=hide'));
  expect(paths(calls)).not.toContain('/api/board');
  expect(search(router)).toEqual({});
  expect(await screen.findByText(t.forksHidden)).toBeVisible();
  // No count on the button and nothing to clear.
  expect(screen.getByRole('button', { name: t.button })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.clear })).toBeNull();

  const forks = within(await openPanel()).getByLabelText(t.forks);
  expect(forks).toHaveValue('hide');
  expect(
    within(forks)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual([t.forkOptions.hide, t.forkOptions.all, t.forkOptions.only]);
});

test('the Forks choices set the address and the board request', async () => {
  const { calls } = stub('forks=only');
  const { router } = renderApp('/prs');
  const forks = within(await openPanel()).getByLabelText(t.forks);

  await userEvent.selectOptions(forks, 'all');
  await waitFor(() => expect(router.state.location.href).toBe('/prs?forks=all'));
  // "Show all" is the API's own default: no `forks` in the request.
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board'));
  expect(screen.getByRole('button', { name: t.buttonCount(1) })).toBeInTheDocument();
  expect(screen.queryByText(t.forksHidden)).toBeNull();

  await userEvent.selectOptions(forks, 'only');
  await waitFor(() => expect(router.state.location.href).toBe('/prs?forks=only'));
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board?forks=only'));
  expect(screen.queryByText(t.forksHidden)).toBeNull();

  await userEvent.selectOptions(forks, 'hide');
  await waitFor(() => expect(router.state.location.href).toBe('/prs'));
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board?forks=hide'));
  expect(screen.getByText(t.forksHidden)).toBeVisible();
});

test('"Show forks" next to the hint shows every PR', async () => {
  const { calls } = stub();
  const { router } = renderApp('/prs');
  await userEvent.click(await screen.findByRole('button', { name: t.showForks }));
  await waitFor(() => expect(search(router)).toEqual({ forks: 'all' }));
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board'));
  expect(screen.queryByText(t.forksHidden)).toBeNull();
});

test('"Clear filters" returns to the defaults: forks stay hidden', async () => {
  const { calls } = stub('person=tomek&repo=wb&forks=only&level=2&drafts=hide');
  const { router } = renderApp('/prs?person=tomek&repo=wb&forks=only&level=2&drafts=hide');
  await userEvent.click(await screen.findByRole('button', { name: t.clear }));
  await waitFor(() => expect(search(router)).toEqual({}));
  expect(router.state.location.href).toBe('/prs');
  expect(await personBox()).toHaveTextContent(t.everyone);
  expect(screen.queryByRole('button', { name: t.clear })).toBeNull();
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board?forks=hide'));
  expect(screen.getByText(t.forksHidden)).toBeVisible();
});

test('"Clear filters" from "Show all" hides forks again', async () => {
  const { calls } = stub();
  const { router } = renderApp('/prs?forks=all');
  await userEvent.click(await screen.findByRole('button', { name: t.clear }));
  await waitFor(() => expect(router.state.location.href).toBe('/prs'));
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board?forks=hide'));
});
