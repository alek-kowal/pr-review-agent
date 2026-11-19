import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { invalidateForChanges } from '@/live/changes.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aFindingsResponse } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { roundFixture } from '@/test/round-fixtures.ts';

const routes = (view: unknown) => ({
  '/api/prs/wb/12': view,
  '/api/prs/wb/12/findings': aFindingsResponse(),
});

afterEach(restoreFetch);

describe('round line', () => {
  it('running: shows the full stepper and the cost so far', async () => {
    stubFetch(routes(roundFixture('running')));
    renderApp('/pr/wb/12');
    expect(await screen.findByTestId('round-line')).toHaveTextContent(
      'Round 1 of 3 · started by hand · running · $0.42 so far',
    );
    expect(screen.getByRole('list', { name: 'Stages of this round' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stages' })).toBeNull();
  });

  it('failed: keeps the stepper open with the cost up to the failure', async () => {
    stubFetch(routes(roundFixture('failed')));
    renderApp('/pr/wb/12');
    expect(await screen.findByTestId('round-line')).toHaveTextContent(
      'failed · $1.12 up to the failure',
    );
    expect(screen.getByRole('list', { name: 'Stages of this round' })).toBeVisible();
  });

  it('finished: one line whose Stages control opens the stepper', async () => {
    stubFetch(routes(roundFixture('finished')));
    renderApp('/pr/wb/12');
    const line = await screen.findByTestId('round-line');
    expect(line.textContent).toMatch(
      /^Round 1 of 3 · started by hand · finished \d\d:\d\d · \$1\.84$/,
    );
    expect(screen.queryByRole('list', { name: 'Stages of this round' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Run details' })).toHaveAttribute('href', '/runs/31');
    const toggle = screen.getByRole('button', { name: 'Stages' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Stages of this round' })).toBeVisible();
  });

  it('level 1: the stepper lists the stages the level turns off', async () => {
    stubFetch(routes(roundFixture('level1')));
    renderApp('/pr/wb/12');
    const list = await screen.findByRole('list', { name: 'Stages of this round' });
    for (const key of ['checks', 'task', 'change_type', 'verify']) {
      expect(list.querySelector(`[data-step="${key}"]`)).toHaveTextContent('off at level 1');
    }
  });

  it('a change event updates the running stage and cost without remounting the page', async () => {
    const stub = stubFetch(routes(roundFixture('running', { current: 'review', costUsd: 0.42 })));
    const { queryClient } = renderApp('/pr/wb/12');
    const page = await screen.findByTestId('round-progress');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(page).toHaveTextContent('$0.42 so far');

    stub.fetchMock.mockClear();
    stubFetch(routes(roundFixture('running', { current: 'review', costUsd: 0.97 })));
    await act(() =>
      invalidateForChanges(queryClient, [{ table: 'agent_sessions', id: 5, prId: 7, runId: 31 }]),
    );
    await waitFor(() => expect(page).toHaveTextContent('$0.97 so far'));
    expect(screen.getByTestId('round-progress')).toBe(page);
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading);
    expect(page.querySelector('[data-step="review"]')).toHaveTextContent('working · $0.95');
  });
});
