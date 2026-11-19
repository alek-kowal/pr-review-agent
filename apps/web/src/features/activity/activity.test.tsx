import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { InProgressResponse, InProgressRun } from '@/lib/api-types.ts';
import { invalidateForChanges } from '@/live/changes.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const run = (over: Partial<InProgressRun> & { id: number }): InProgressRun => ({
  kind: 'round',
  status: 'running',
  roundNumber: 1,
  level: { number: 1, key: 'diff' },
  currentStage: 'checks',
  costUsd: 0,
  createdAt: '2026-11-19T10:00:00.000Z',
  startedAt: '2026-11-19T10:00:05.000Z',
  pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
  ...over,
});

const answer = (runs: InProgressRun[]): InProgressResponse => ({ runs });

const rowOf = (table: HTMLElement, runId: number) => {
  const row = within(table)
    .getAllByRole('row')
    .find((tr) => tr.dataset.run === String(runId));
  if (!row) throw new Error(`no row for run ${runId}`);
  return row;
};

describe('Activity', () => {
  it('lists running and queued runs, each linking to Run detail', async () => {
    stubFetch({
      '/api/activity/in-progress': answer([
        run({ id: 41, currentStage: 'review', costUsd: 0.42 }),
        run({
          id: 42,
          status: 'queued',
          currentStage: null,
          startedAt: null,
          pullRequest: { repository: { slug: 'wb' }, number: 13, title: 'Fix edge routing' },
        }),
      ]),
    });
    renderApp('/activity');

    const table = await screen.findByRole('table', { name: copy.activity.inProgress.title });
    const running = rowOf(table, 41);
    expect(within(running).getByTestId('run-stage')).toHaveTextContent(copy.stages.review!);
    expect(within(running).getByTestId('run-cost')).toHaveTextContent('$0.42');
    expect(within(running).getByRole('link', { name: 'Round 1 of 3' })).toHaveAttribute(
      'href',
      '/runs/41',
    );
    expect(within(running).getByRole('link', { name: 'Add node grouping' })).toHaveAttribute(
      'href',
      '/pr/wb/12',
    );

    const queued = rowOf(table, 42);
    expect(within(queued).getByTestId('run-stage')).toHaveTextContent(
      copy.activity.inProgress.queued,
    );
    expect(queued).toHaveTextContent(copy.activity.inProgress.notStarted);
  });

  it('a change event updates a row’s stage and cost without remounting the table', async () => {
    stubFetch({ '/api/activity/in-progress': answer([run({ id: 41, costUsd: 0.05 })]) });
    const { queryClient } = renderApp('/activity');

    const table = await screen.findByRole('table', { name: copy.activity.inProgress.title });
    expect(within(rowOf(table, 41)).getByTestId('run-stage')).toHaveTextContent(
      copy.stages.checks!,
    );

    stubFetch({
      '/api/activity/in-progress': answer([run({ id: 41, currentStage: 'review', costUsd: 0.37 })]),
    });
    await act(() =>
      invalidateForChanges(queryClient, [{ table: 'runs', id: 41, prId: 7, runId: 41 }]),
    );

    await waitFor(() =>
      expect(within(rowOf(table, 41)).getByTestId('run-cost')).toHaveTextContent('$0.37'),
    );
    expect(within(rowOf(table, 41)).getByTestId('run-stage')).toHaveTextContent(
      copy.stages.review!,
    );
    expect(screen.getByRole('table', { name: copy.activity.inProgress.title })).toBe(table);
  });

  it('says when nothing is running or queued', async () => {
    stubFetch({ '/api/activity/in-progress': answer([]) });
    renderApp('/activity');

    expect(await screen.findByText(copy.activity.inProgress.empty)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
