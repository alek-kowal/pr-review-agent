import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: '77',
};
const t = copy.team;

beforeEach(() => window.localStorage.clear());
afterEach(restoreFetch);

const callsTo = (calls: FetchCall[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

async function pickSigner(dialog: HTMLElement, name: string) {
  await userEvent.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('Settings → Team', () => {
  test('lists the members in the Settings shell', async () => {
    stubFetch({ '/api/team': { members: [kasia, tomek] } });
    renderApp('/settings');

    const table = await screen.findByRole('table', { name: t.tableLabel });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Kasia@kasia—'),
      expect.stringContaining('Tomek@tomek77'),
    ]);
    const nav = screen.getByRole('navigation', { name: copy.settings.navLabel });
    expect(within(nav).getByRole('link', { name: copy.settings.pages.team })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(t.affects, { exact: false })).toBeInTheDocument();
  });

  test('Add posts the fields with signedBy and refreshes Team', async () => {
    window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id);
    const ola = { id: 'm-ola', name: 'Ola', githubLogin: 'ola-dev', clickupUserId: '901' };
    const { calls } = stubFetch({
      '/api/team': { members: [kasia, tomek] },
      'POST /api/team': { status: 201, body: { member: ola } },
    });
    renderApp('/settings/team');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.add }));
    const dialog = await screen.findByRole('dialog', { name: t.addDialog.title });
    await user.type(within(dialog).getByLabelText(t.fields.name), 'Ola');
    await user.type(within(dialog).getByLabelText(t.fields.githubLogin), '@ola-dev');
    await user.type(within(dialog).getByLabelText(t.fields.clickupUser), '901');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    const gets = callsTo(calls, 'GET', '/api/team').length;
    await user.click(within(dialog).getByRole('button', { name: t.addDialog.confirm }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(callsTo(calls, 'POST', '/api/team')).toEqual([
      expect.objectContaining({
        body: { name: 'Ola', githubLogin: 'ola-dev', clickupUserId: '901', signedBy: tomek.id },
        headers: expect.objectContaining({ 'X-PRA-Request': '1' }),
      }),
    ]);
    await waitFor(() => expect(callsTo(calls, 'GET', '/api/team').length).toBeGreaterThan(gets));
  });

  test('Remove asks for confirmation and a signature', async () => {
    const { calls } = stubFetch({
      '/api/team': { members: [kasia, tomek] },
      'DELETE /api/team/m-kasia': { status: 204, body: null },
    });
    renderApp('/settings/team');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.remove('Kasia') }));
    const dialog = await screen.findByRole('alertdialog', { name: t.removeDialog.title('Kasia') });
    await user.click(within(dialog).getByRole('button', { name: t.removeDialog.confirm }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(copy.signature.required);
    expect(callsTo(calls, 'DELETE', '/api/team/m-kasia')).toEqual([]);

    await pickSigner(dialog, 'Tomek');
    await user.click(within(dialog).getByRole('button', { name: t.removeDialog.confirm }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(callsTo(calls, 'DELETE', '/api/team/m-kasia')).toEqual([
      expect.objectContaining({
        body: {
          signedBy: tomek.id,
          before: { name: 'Kasia', githubLogin: 'kasia', clickupUserId: null },
        },
      }),
    ]);
    expect(window.localStorage.getItem(LAST_SIGNER_KEY)).toBe(tomek.id);
  });

  test('signer_unknown from the api shows its copy and keeps the dialog', async () => {
    window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id);
    const { calls } = stubFetch({
      '/api/team': { members: [kasia, tomek] },
      'PATCH /api/team/m-kasia': {
        status: 400,
        body: { error: { code: 'signer_unknown', params: { signer: tomek.id } } },
      },
    });
    renderApp('/settings/team');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.edit('Kasia') }));
    const dialog = await screen.findByRole('dialog', { name: t.editDialog.title('Kasia') });
    const name = within(dialog).getByLabelText(t.fields.name);
    await user.clear(name);
    await user.type(name, 'Kasia Nowak');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(within(dialog).getByRole('button', { name: t.editDialog.confirm }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.signer_unknown!);
    expect(callsTo(calls, 'PATCH', '/api/team/m-kasia')[0]?.body).toEqual({
      name: 'Kasia Nowak',
      githubLogin: 'kasia',
      clickupUserId: null,
      signedBy: tomek.id,
      before: { name: 'Kasia', githubLogin: 'kasia', clickupUserId: null },
    });
    expect(window.localStorage.getItem(LAST_SIGNER_KEY)).toBe(tomek.id);
  });

  test('the first person signs as themselves', async () => {
    const { calls } = stubFetch({
      '/api/team': { members: [] },
      'POST /api/team': { status: 201, body: { member: kasia } },
    });
    renderApp('/settings/team');
    const user = userEvent.setup();

    expect(await screen.findByText(t.empty)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.add }));
    const dialog = await screen.findByRole('dialog', { name: t.addDialog.title });
    expect(within(dialog).getByText(t.firstMember)).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    await user.type(within(dialog).getByLabelText(t.fields.name), 'Kasia');
    await user.type(within(dialog).getByLabelText(t.fields.githubLogin), 'kasia');
    await user.click(within(dialog).getByRole('button', { name: t.addDialog.confirm }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(callsTo(calls, 'POST', '/api/team')[0]?.body).toEqual({
      name: 'Kasia',
      githubLogin: 'kasia',
      clickupUserId: null,
    });
  });

  test('a person needs a name and a GitHub login', async () => {
    window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id);
    const { calls } = stubFetch({ '/api/team': { members: [kasia, tomek] } });
    renderApp('/settings/team');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.add }));
    const dialog = await screen.findByRole('dialog', { name: t.addDialog.title });
    await user.type(within(dialog).getByLabelText(t.fields.name), 'Ola');
    await user.click(within(dialog).getByRole('button', { name: t.addDialog.confirm }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(t.required);
    expect(callsTo(calls, 'POST', '/api/team')).toEqual([]);
  });
});
