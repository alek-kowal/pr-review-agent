// S-17-T4: the board filters live in the page address.
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

function stub(...queries: string[]) {
  return stubFetch({
    '/api/team': team,
    '/api/board': board,
    ...Object.fromEntries(queries.map((q) => [`/api/board?${q}`, board])),
  });
}

const personBox = () => screen.findByRole('combobox', { name: t.person });

async function openPanel() {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${t.button}`) }));
  return screen.findByRole('dialog', { name: t.panelLabel });
}

const search = (router: ReturnType<typeof renderApp>['router']) => router.state.location.search;

test('choosing a filter updates the search params and the board request', async () => {
  const { calls } = stub(
    'person=kasia',
    'person=kasia&level=3',
    'person=kasia&level=3&drafts=hide',
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
    expect(calls.map((c) => c.path)).toContain('/api/board?person=kasia&level=3&drafts=hide'),
  );
});

test('loading a URL with params preselects them', async () => {
  const query = 'person=kasia&repo=docs&forks=hide&level=3&drafts=hide';
  const { calls } = stub(query);
  renderApp(`/prs?${query}`);

  await waitFor(() => expect(calls.map((c) => c.path)).toContain(`/api/board?${query}`));
  await waitFor(async () => expect(await personBox()).toHaveTextContent('Kasia'));
  const button = screen.getByRole('button', { name: t.buttonCount(4) });
  expect(button).toBeInTheDocument();
  const panel = await openPanel();
  expect(within(panel).getByLabelText(t.repository)).toHaveValue('docs');
  expect(within(panel).getByLabelText(t.forks)).toHaveValue('hide');
  expect(within(panel).getByLabelText(t.level)).toHaveValue('3');
  expect(within(panel).getByRole('checkbox', { name: t.hideDrafts })).toBeChecked();
});

test('an invalid value in the address is dropped', async () => {
  const { calls } = stub('forks=only');
  const { router } = renderApp('/prs?forks=only&level=9&drafts=show');
  await waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/board?forks=only'));
  expect(search(router)).toEqual({ forks: 'only' });
});

test('"Clear filters" resets them all', async () => {
  const { calls } = stub('person=tomek&repo=wb&forks=only&level=2&drafts=hide');
  const { router } = renderApp('/prs?person=tomek&repo=wb&forks=only&level=2&drafts=hide');
  await userEvent.click(await screen.findByRole('button', { name: t.clear }));
  await waitFor(() => expect(search(router)).toEqual({}));
  expect(router.state.location.href).toBe('/prs');
  expect(await personBox()).toHaveTextContent(t.everyone);
  expect(screen.queryByRole('button', { name: t.clear })).toBeNull();
  await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/board'));
});
