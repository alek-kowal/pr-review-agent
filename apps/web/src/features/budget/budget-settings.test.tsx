// S-10-T5: Settings → General → Budget & status: status, spend, daily budget and agent slots.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { StatusResponse } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aStatus } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.budget;
const kasia = { id: 'm-kasia', name: 'Kasia', githubLogin: 'kasia', clickupUserId: null };
const STATUS = aStatus({ todaySpendUsd: 12.4, dailyBudgetUsd: 50, queuedCount: 2 });

function stub(status: StatusResponse, routes: Record<string, unknown> = {}) {
  return stubFetch({ '/api/status': status, '/api/team': { members: [kasia] }, ...routes });
}

const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET');

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, kasia.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

describe('Budget & status', () => {
  it('is in the Settings sidebar and shows status, spend, budget, slots and the queue', async () => {
    stub(STATUS);
    renderApp('/settings/budget');

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeVisible();
    expect(screen.getByRole('link', { name: copy.settings.pages.budget })).toHaveAttribute(
      'href',
      '/settings/budget',
    );
    const status = await screen.findByRole('region', { name: t.status.title });
    expect(within(status).getByText(t.states.running)).toBeVisible();
    const spend = screen.getByRole('region', { name: t.spend.title });
    expect(within(spend).getByText('$12.40')).toBeVisible();
    expect(within(spend).getByText('of $50.00')).toBeVisible();
    expect(within(spend).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(within(spend).getByLabelText(t.spend.dailyBudget)).toHaveValue('50');
    const queue = screen.getByRole('region', { name: t.queue.title });
    expect(within(queue).getByLabelText(t.queue.slots)).toHaveValue(2);
    expect(within(queue).getByText('2 rounds queued')).toBeVisible();
  });

  it('saves the daily budget and agent slots signed, with before and after', async () => {
    const { calls } = stub(STATUS, {
      'PUT /api/status/budget': aStatus({ dailyBudgetUsd: 40 }),
      'PUT /api/status/slots': aStatus({ dailyBudgetUsd: 40, agentSlots: 3 }),
    });
    renderApp('/settings/budget');
    const budget = await screen.findByLabelText(t.spend.dailyBudget);
    await userEvent.clear(budget);
    await userEvent.type(budget, '40');
    const slots = screen.getByLabelText(t.queue.slots);
    await userEvent.clear(slots);
    await userEvent.type(slots, '3');

    await userEvent.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('rowheader', { name: t.spend.dailyBudget })).toBeVisible();
    expect(within(dialog).getByText('$40.00')).toBeVisible();
    expect(within(dialog).getByRole('rowheader', { name: t.queue.slots })).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)).toMatchObject([
      {
        path: '/api/status/budget',
        body: { dailyBudgetUsd: 40, before: { dailyBudgetUsd: 50 }, signedBy: kasia.id },
      },
      {
        path: '/api/status/slots',
        body: { agentSlots: 3, before: { agentSlots: 2 }, signedBy: kasia.id },
      },
    ]);
  });

  it('an empty budget saves "no budget"; an invalid one cannot be saved', async () => {
    const { calls } = stub(STATUS, { 'PUT /api/status/budget': aStatus() });
    renderApp('/settings/budget');
    const budget = await screen.findByLabelText(t.spend.dailyBudget);

    await userEvent.clear(budget);
    await userEvent.type(budget, '-5');
    expect(screen.getByText(t.spend.invalid)).toBeVisible();
    expect(screen.queryByRole('button', { name: copy.settings.saveBar.save })).toBeNull();

    await userEvent.clear(budget);
    await userEvent.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(t.save.noBudget)).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );
    await waitFor(() =>
      expect(writes(calls)).toMatchObject([
        { path: '/api/status/budget', body: { dailyBudgetUsd: null } },
      ]),
    );
  });

  it('pauses with a reason, signed in the dialog', async () => {
    const { calls } = stub(STATUS, {
      'POST /api/status/pause': aStatus({
        state: 'paused',
        pausedBy: { id: kasia.id, name: 'Kasia' },
        pausedReason: 'release freeze',
      }),
    });
    renderApp('/settings/budget');
    const pause = await screen.findByRole('button', { name: t.status.pauseButton });
    expect(pause).toBeDisabled();
    await userEvent.type(screen.getByLabelText(t.status.pause), 'release freeze');
    await userEvent.click(pause);

    const dialog = await screen.findByRole('alertdialog', { name: t.status.pauseTitle });
    expect(within(dialog).getByText('Paused: release freeze')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: t.status.pauseConfirm }));

    await waitFor(() =>
      expect(writes(calls)).toMatchObject([
        { path: '/api/status/pause', body: { reason: 'release freeze', signedBy: kasia.id } },
      ]),
    );
    expect(await screen.findByText(t.status.pausedBy('Kasia'))).toBeVisible();
  });

  it('resumes while paused', async () => {
    const { calls } = stub(
      aStatus({
        state: 'paused',
        pausedBy: { id: kasia.id, name: 'Kasia' },
        pausedReason: 'release freeze',
        pausedAt: '2026-11-19T09:30:00.000Z',
      }),
      { 'POST /api/status/resume': aStatus() },
    );
    renderApp('/settings/budget');
    expect(await screen.findByText(t.status.pausedBy('Kasia'))).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: t.status.resume }));

    const dialog = await screen.findByRole('alertdialog', { name: t.status.resumeTitle });
    await userEvent.click(within(dialog).getByRole('button', { name: t.status.resumeConfirm }));
    await waitFor(() =>
      expect(writes(calls)).toMatchObject([
        { path: '/api/status/resume', body: { signedBy: kasia.id } },
      ]),
    );
  });
});
