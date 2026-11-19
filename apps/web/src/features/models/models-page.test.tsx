// S-21-T4: Settings → Models.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { ModelsResponse, TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.models;
const PATH = '/api/settings/models';
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const DEFAULTS = {
  reviewer: 'claude-opus-5-5',
  verifier: 'claude-sonnet-5-5',
  implementer: 'claude-opus-5-5',
  judge: 'claude-haiku-5-5',
  analyst: 'claude-sonnet-5-5',
};

const response = (over: Partial<ModelsResponse> = {}): ModelsResponse => ({
  models: { ...DEFAULTS },
  defaults: { ...DEFAULTS },
  overrides: [],
  ...over,
});

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

const roleRow = async (role: string) => {
  const cell = await screen.findByText(t.roles[role]!);
  return cell.closest('tr')!;
};
const puts = (calls: FetchCall[]) =>
  calls.filter((call) => call.method === 'PUT' && call.path === PATH);

describe('Settings → Models', () => {
  test('the override note lists the levels that set their own model', async () => {
    stubFetch({
      [PATH]: response({
        overrides: [
          { level: 4, role: 'reviewer', model: 'claude-sonnet-5-5' },
          { level: 6, role: 'reviewer', model: 'claude-opus-5-5' },
          { level: 6, role: 'judge', model: 'claude-sonnet-5-5' },
        ],
      }),
    });
    renderApp('/settings/models');

    const reviewer = await roleRow('reviewer');
    const items = within(reviewer)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      t.overrideNote(4, 'claude-sonnet-5-5'),
      t.overrideNote(6, 'claude-opus-5-5'),
    ]);
    expect(await roleRow('judge')).toHaveTextContent(t.overrideNote(6, 'claude-sonnet-5-5'));
    expect(await roleRow('verifier')).toHaveTextContent(t.noOverrides);
  });

  test('an invalid model name shows the error and blocks the save', async () => {
    const { calls } = stubFetch({ [PATH]: response(), '/api/team': { members: [tomek] } });
    renderApp('/settings/models');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: t.modelLabel('verifier') }));
    await user.click(await screen.findByRole('option', { name: t.other }));
    const input = screen.getByRole('textbox', { name: t.customLabel('verifier') });
    await user.clear(input);
    await user.type(input, '--model=x');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t.invalid)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.invalidSummary);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // A name with a space is refused the same way.
    await user.clear(input);
    await user.type(input, 'claude opus');
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);
  });

  test('a typed model saves signed with before and after', async () => {
    const { calls } = stubFetch({
      [PATH]: response(),
      '/api/team': { members: [tomek] },
      [`PUT ${PATH}`]: response({ models: { ...DEFAULTS, verifier: 'claude-sonnet-5-6' } }),
    });
    renderApp('/settings/models');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: t.modelLabel('verifier') }));
    await user.click(await screen.findByRole('option', { name: t.other }));
    const input = screen.getByRole('textbox', { name: t.customLabel('verifier') });
    await user.clear(input);
    await user.type(input, 'claude-sonnet-5-6');
    expect(screen.getByRole('region', { name: copy.settings.saveBar.label })).toHaveTextContent(
      copy.settings.unsaved(1),
    );
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));

    const dialog = await screen.findByRole('alertdialog', { name: t.saveTitle });
    expect(within(dialog).getByRole('row', { name: /Verifier/ })).toHaveTextContent(
      'Verifierclaude-sonnet-5-5claude-sonnet-5-6',
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]?.body).toEqual({
      models: { ...DEFAULTS, verifier: 'claude-sonnet-5-6' },
      before: DEFAULTS,
      signedBy: tomek.id,
    });
  });
});
