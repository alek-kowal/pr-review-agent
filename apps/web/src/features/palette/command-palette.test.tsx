// S-17-T5: one command palette for PRs, people, settings pages and actions.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { anEmptyBoard } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const t = copy.palette;
const hit = (number: number, title: string) => ({
  repository: { slug: 'wb' },
  number,
  title,
  author: { login: 'kasia', name: 'Kasia' },
  state: 'open' as const,
});

function stub() {
  return stubFetch({
    '/api/board?forks=hide': anEmptyBoard(),
    '/api/team': {
      members: [{ id: 'm-1', name: 'Kasia', githubLogin: 'kasia', clickupUserId: null }],
    },
    '/api/search?q=272': {
      pullRequests: [hit(272, 'Add node grouping'), hit(1272, 'Mention 272 in the docs')],
    },
  });
}

const dialog = () => screen.findByRole('dialog', { name: t.title });
const trigger = () => screen.getByRole('button', { name: new RegExp(t.trigger) });

test('⌘K opens it, and Escape returns focus to the trigger', async () => {
  stub();
  renderApp('/prs');
  await screen.findByRole('heading', { name: copy.board.title });

  await userEvent.keyboard('{Meta>}k{/Meta}');
  expect(await dialog()).toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger()).toHaveFocus();
});

test('`/` opens it, but not while typing', async () => {
  stub();
  renderApp('/prs');
  await screen.findByRole('heading', { name: copy.board.title });

  await userEvent.keyboard('/');
  expect(await dialog()).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  // Typing "/" into the person search does not open the palette.
  await userEvent.click(screen.getByRole('combobox', { name: copy.board.filters.person }));
  await userEvent.type(await screen.findByPlaceholderText(copy.board.filters.searchPeople), '/');
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
});

test('the top-bar search opens it; Escape returns focus to it', async () => {
  stub();
  renderApp('/prs');
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(t.trigger) }));
  const palette = await dialog();
  // People, Settings pages and Actions are listed before anything is typed.
  expect(within(palette).getByRole('group', { name: t.groups.people })).toHaveTextContent('Kasia');
  expect(within(palette).getByRole('group', { name: t.groups.settings })).toHaveTextContent(
    copy.settings.pages.team,
  );
  expect(within(palette).getByRole('group', { name: t.groups.actions })).toHaveTextContent(
    t.actions.pause!,
  );
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger()).toHaveFocus();
});

test('typing "272" lists PR #272 first, and Enter navigates to it', async () => {
  stub();
  const { router } = renderApp('/prs');
  await screen.findByRole('heading', { name: copy.board.title });
  await userEvent.keyboard('{Meta>}k{/Meta}');
  await userEvent.type(screen.getByRole('combobox'), '272');

  const prs = await within(await dialog()).findByRole('group', { name: t.groups.pullRequests });
  const options = within(prs).getAllByRole('option');
  expect(options[0]).toHaveTextContent('Add node grouping');
  expect(options[0]).toHaveTextContent('#272');
  expect(options[0]).toHaveAttribute('aria-selected', 'true');

  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(router.state.location.pathname).toBe('/pr/wb/272'));
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
});

test('arrow keys move the selection; a person opens the board filtered to them', async () => {
  stub();
  const { router } = renderApp('/activity');
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(t.trigger) }));
  await userEvent.type(screen.getByRole('combobox'), 'kas');
  const person = await within(await dialog()).findByRole('option', { name: /Kasia/ });
  await waitFor(() => expect(person).toHaveAttribute('aria-selected', 'true'));
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(router.state.location.href).toBe('/prs?person=kasia'));
});

test('arrow keys move, and an action runs once the palette has closed', async () => {
  stub();
  const opened = vi.fn(() => expect(screen.queryByRole('dialog', { name: t.title })).toBeNull());
  window.addEventListener('pra:open-status-chip', opened);
  renderApp('/prs');
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(t.trigger) }));
  const palette = await dialog();
  const options = within(palette).getAllByRole('option');
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowDown}');
  expect(options[1]).toHaveAttribute('aria-selected', 'true');

  await userEvent.type(screen.getByRole('combobox'), 'pause');
  await waitFor(() =>
    expect(within(palette).getAllByRole('option')[0]).toHaveTextContent(t.actions.pause!),
  );
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(opened).toHaveBeenCalledOnce());
  window.removeEventListener('pra:open-status-chip', opened);
});
