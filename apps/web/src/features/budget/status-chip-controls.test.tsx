// S-10-T5: the status chip's states, spend bar, and its signed pause, resume and budget controls.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { StatusResponse } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { anEmptyBoard, aStatus } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const tomek = { id: 'm-tomek', name: 'Tomek', githubLogin: 'tomek', clickupUserId: null };
const PAUSED = aStatus({
  state: 'paused',
  pausedBy: { id: tomek.id, name: 'Tomek' },
  pausedReason: 'release freeze',
  pausedAt: '2026-11-19T09:30:00.000Z',
});

function stub(status: StatusResponse, routes: Record<string, unknown> = {}) {
  return stubFetch({
    '/api/status': status,
    '/api/board?forks=hide': anEmptyBoard(),
    '/api/team': { members: [tomek] },
    ...routes,
  });
}

async function openChip(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('group', { name: copy.status.label });
}

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

describe('chip states', () => {
  it('running with a budget: "$12.40 of $50.00 today" and a progress bar', async () => {
    stub(aStatus({ todaySpendUsd: 12.4, dailyBudgetUsd: 50 }));
    renderApp('/prs');
    const panel = await openChip(/Running · \$12\.40 of \$50\.00 today/);
    const bar = within(panel).getByRole('progressbar', { name: copy.status.spentPercent });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
  });

  it('paused: "Paused by Tomek (release freeze)" in the warn tone', async () => {
    stub(PAUSED);
    renderApp('/prs');
    const chip = await screen.findByRole('button', {
      name: /Paused by Tomek \(release freeze\)/,
    });
    expect(chip).toHaveAttribute('data-status-chip', 'paused');
    expect(chip.className).toContain('text-warn');
  });

  it('budget reached: "Daily budget reached" in the bad tone, with the hint', async () => {
    stub(aStatus({ state: 'budget_reached', todaySpendUsd: 50.2, dailyBudgetUsd: 50 }));
    renderApp('/prs');
    const chip = await screen.findByRole('button', {
      name: /Daily budget reached · \$50\.20 of \$50\.00/,
    });
    expect(chip.className).toContain('text-bad');
    await userEvent.click(chip);
    expect(await screen.findByText(copy.status.budgetUsedUp)).toBeVisible();
  });

  it('a queued count links to Activity', async () => {
    stub(aStatus({ queuedCount: 3 }));
    renderApp('/prs');
    const panel = await openChip(/Running/);
    expect(within(panel).getByRole('link', { name: '3 rounds queued' })).toHaveAttribute(
      'href',
      '/activity',
    );
  });
});

describe('signed controls', () => {
  it('Pause needs a reason, then sends it signed', async () => {
    const { calls } = stub(aStatus(), { 'POST /api/status/pause': PAUSED });
    renderApp('/prs');
    const panel = await openChip(/Running/);

    await userEvent.click(within(panel).getByRole('button', { name: copy.status.pause.button }));
    expect(within(panel).getByRole('alert')).toHaveTextContent(copy.status.pause.reasonRequired);

    await userEvent.type(within(panel).getByLabelText(copy.status.pause.label), 'release freeze');
    await userEvent.click(within(panel).getByRole('button', { name: copy.status.pause.button }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/status/pause',
        body: { reason: 'release freeze', signedBy: tomek.id },
      }),
    );
    expect(
      await screen.findByRole('button', { name: /Paused by Tomek \(release freeze\)/ }),
    ).toBeVisible();
  });

  it('Pause without a signer asks for one and sends nothing', async () => {
    window.localStorage.clear();
    const { calls } = stub(aStatus());
    renderApp('/prs');
    const panel = await openChip(/Running/);
    await userEvent.type(within(panel).getByLabelText(copy.status.pause.label), 'freeze');
    await userEvent.click(within(panel).getByRole('button', { name: copy.status.pause.button }));

    expect(within(panel).getByRole('alert')).toHaveTextContent(copy.signature.required);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('Resume while paused sends the signature', async () => {
    const { calls } = stub(PAUSED, { 'POST /api/status/resume': aStatus() });
    renderApp('/prs');
    const panel = await openChip(/Paused by Tomek/);
    expect(within(panel).getByText('release freeze')).toBeVisible();

    await userEvent.click(within(panel).getByRole('button', { name: copy.status.paused.resume }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/status/resume',
        body: { signedBy: tomek.id },
      }),
    );
  });

  it('Save budget sends the new amount with what it replaces', async () => {
    const { calls } = stub(aStatus({ dailyBudgetUsd: 50 }), {
      'PUT /api/status/budget': aStatus({ dailyBudgetUsd: 60 }),
    });
    renderApp('/prs');
    const panel = await openChip(/Running/);
    const input = within(panel).getByLabelText(copy.status.budget.label);

    await userEvent.click(within(panel).getByRole('button', { name: copy.status.budget.save }));
    expect(within(panel).getByRole('alert')).toHaveTextContent(copy.status.budget.unchanged);

    await userEvent.clear(input);
    await userEvent.type(input, '60');
    await userEvent.click(within(panel).getByRole('button', { name: copy.status.budget.save }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/api/status/budget',
        body: { dailyBudgetUsd: 60, before: { dailyBudgetUsd: 50 }, signedBy: tomek.id },
      }),
    );
  });

  it('a refused change shows its reason', async () => {
    stub(aStatus(), {
      'POST /api/status/pause': {
        status: 409,
        body: { error: { code: 'already_paused', params: {} } },
      },
    });
    renderApp('/prs');
    const panel = await openChip(/Running/);
    await userEvent.type(within(panel).getByLabelText(copy.status.pause.label), 'freeze');
    await userEvent.click(within(panel).getByRole('button', { name: copy.status.pause.button }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(copy.errors.already_paused!);
  });
});
