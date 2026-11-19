// S-21-T9: Settings → Alerts.
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from '@pra/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { AlertSettingsResponse, TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.alerts.settings;
const PATH = '/api/settings/alerts';
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};
const SAVED: AlertConfig = { ...DEFAULT_ALERT_CONFIG, generalTaskId: '86abc' };
const response = (config: AlertConfig = SAVED): AlertSettingsResponse => ({ config });

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

const puts = (calls: FetchCall[]) =>
  calls.filter((call) => call.method === 'PUT' && call.path === PATH);
const saveBar = () => screen.getByRole('region', { name: copy.settings.saveBar.label });

describe('Settings → Alerts', () => {
  test('the save bar counts the changes and the dialog shows before and after', async () => {
    const { calls } = stubFetch({
      [PATH]: response(),
      '/api/team': { members: [tomek] },
      [`PUT ${PATH}`]: response({ ...SAVED, failedOn: false, costMaxUsd: 7.5 }),
    });
    renderApp('/settings/alerts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: t.failed.toggle }));
    expect(saveBar()).toHaveTextContent(copy.settings.unsaved(1));
    const cost = screen.getByRole('textbox', { name: t.cost.input });
    await user.clear(cost);
    await user.type(cost, '7.5');
    expect(saveBar()).toHaveTextContent(copy.settings.unsaved(2));
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));

    const dialog = await screen.findByRole('alertdialog', { name: t.saveTitle });
    expect(within(dialog).getByRole('row', { name: new RegExp(t.failed.label) })).toHaveTextContent(
      `${t.failed.label}${t.on}${t.off}`,
    );
    expect(within(dialog).getByRole('row', { name: new RegExp(t.cost.label) })).toHaveTextContent(
      `${t.cost.label}${t.values.cost(5)}${t.values.cost(7.5)}`,
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
      config: { ...SAVED, failedOn: false, costMaxUsd: 7.5 },
      before: SAVED,
      signedBy: tomek.id,
    });
  });

  test('a missing general task or a cost of 0 blocks the save', async () => {
    const { calls } = stubFetch({
      [PATH]: response({ ...SAVED, generalTaskId: null }),
      '/api/team': { members: [tomek] },
    });
    renderApp('/settings/alerts');
    const user = userEvent.setup();

    const cost = await screen.findByRole('textbox', { name: t.cost.input });
    await user.clear(cost);
    await user.type(cost, '0');
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t.invalidSummary);
    expect(cost).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(t.cost.invalid)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: t.task.input })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText(t.task.invalid)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);
  });

  test('the budget threshold reads "and 100%" in the dialog', async () => {
    stubFetch({ [PATH]: response(), '/api/team': { members: [tomek] } });
    renderApp('/settings/alerts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: t.budget.select }));
    await user.click(await screen.findByRole('option', { name: t.budget.percent(90) }));
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));

    const dialog = await screen.findByRole('alertdialog', { name: t.saveTitle });
    expect(within(dialog).getByRole('row', { name: new RegExp(t.budget.label) })).toHaveTextContent(
      `${t.budget.label}${t.values.budget(80)}${t.values.budget(90)}`,
    );
  });

  test('the preview shows the ClickUp comment with the typed threshold', async () => {
    stubFetch({ [PATH]: response() });
    renderApp('/settings/alerts');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.comment.show }));
    const preview = document.querySelector('[data-comment-preview]');
    expect(preview).toHaveTextContent('PR Review Agent alert · PR #42');
    expect(preview).toHaveTextContent('above the $5.00 alert threshold');
    expect(preview).toHaveTextContent(`${window.location.origin}/pr/${t.comment.sampleRepo}/42`);

    const cost = screen.getByRole('textbox', { name: t.cost.input });
    await user.clear(cost);
    await user.type(cost, '12');
    expect(preview).toHaveTextContent('above the $12.00 alert threshold');
    await user.click(screen.getByRole('button', { name: t.comment.hide }));
    expect(document.querySelector('[data-comment-preview]')).toBeNull();
  });
});
