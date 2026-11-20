// S-18-T6: alerts in Activity, on the board, in the PR banner and on the status chip.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { AlertsResponse, AlertView } from '@/lib/api-types.ts';
import { targetsOf } from '@/live/changes.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import {
  aBoardCard,
  aFindingsResponse,
  anAlert,
  anEmptyBoard,
  aPrView,
  aStatus,
} from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const failed = anAlert({
  id: 1,
  kind: 'failed',
  runId: 77,
  title: {
    code: 'alert_failed',
    params: { prNumber: 12, stage: 'review', errorCode: 'stage_timeout', timeoutMinutes: 20 },
  },
  nextStep: { code: 'alert_next_retry', params: { stage: 'review' } },
  pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
});
const cost = anAlert({ id: 2 });
const rounds = anAlert({
  id: 3,
  kind: 'rounds',
  title: { code: 'alert_rounds', params: { prNumber: 13, max: 3 } },
  nextStep: { code: 'alert_next_start_review', params: {} },
  pullRequest: { repository: { slug: 'wb' }, number: 13, title: 'Fix edge routing' },
});
const cleared = anAlert({
  id: 4,
  kind: 'budget',
  status: 'resolved',
  title: { code: 'alert_budget', params: { percent: 80, spentUsd: 16, budgetUsd: 20 } },
  nextStep: { code: 'alert_next_budget', params: {} },
  pullRequest: null,
  endedAt: new Date().toISOString(),
  endedBy: 'bot',
  endNote: { code: 'alert_end_midnight', params: {} },
});
const dismissed = anAlert({
  id: 5,
  status: 'dismissed',
  endedAt: new Date().toISOString(),
  endedBy: 'hand',
});

const lists = (active: AlertView[], past: AlertView[] = []) => ({
  '/api/alerts?status=active': {
    alerts: active,
    activeCount: active.length,
    pastCount: past.length,
  } satisfies AlertsResponse,
  '/api/alerts?status=past': {
    alerts: past,
    activeCount: active.length,
    pastCount: past.length,
  } satisfies AlertsResponse,
});

const rowOf = (table: HTMLElement, id: number) => {
  const row = within(table)
    .getAllByRole('row')
    .find((tr) => tr.dataset.alert === String(id));
  if (!row) throw new Error(`no row for alert ${id}`);
  return row;
};

describe('Activity → Alerts', () => {
  it('a failed-run row has Retry, a cost row has Dismiss, a rounds row neither', async () => {
    const { calls } = stubFetch({
      ...lists([failed, cost, rounds]),
      '/api/activity/in-progress': { runs: [] },
      'POST /api/runs/77/retry': { run: { id: 78, fromStage: 'review' } },
      'POST /api/alerts/2/dismiss': { alert: { ...cost, status: 'dismissed', endedBy: 'hand' } },
    });
    renderApp('/activity');

    const table = await screen.findByRole('table', { name: copy.alerts.section.title });
    expect(screen.getByRole('link', { name: copy.alerts.section.settings })).toHaveAttribute(
      'href',
      '/settings/alerts',
    );
    const failedRow = rowOf(table, failed.id);
    expect(failedRow).toHaveTextContent('Review stage timed out after 20 min on #12');
    expect(
      within(failedRow).getByRole('link', { name: copy.alerts.section.runDetails }),
    ).toHaveAttribute('href', '/runs/77');
    await userEvent.click(within(failedRow).getByRole('button', { name: 'Retry from Review' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/runs/77/retry')).toBe(true),
    );

    const costRow = rowOf(table, cost.id);
    expect(costRow).toHaveTextContent('#142 has cost $5.40, above the $5.00 alert threshold');
    expect(costRow).toHaveTextContent('Check whether the PR should be split');
    await userEvent.click(
      within(costRow).getByRole('button', { name: copy.alerts.dismiss.action }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/alerts/2/dismiss')).toBe(
        true,
      ),
    );

    expect(within(rowOf(table, rounds.id)).queryByRole('button')).toBeNull();
    expect(screen.getByTestId('alerts-count')).toHaveTextContent('3');
  });

  it('past alerts start collapsed and show their count', async () => {
    const { calls } = stubFetch({
      ...lists([], [cleared, dismissed]),
      '/api/activity/in-progress': { runs: [] },
    });
    renderApp('/activity');

    expect(await screen.findByText(copy.alerts.section.calm)).toBeVisible();
    const toggle = screen.getByRole('button', { name: copy.alerts.section.showPast(2) });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: copy.alerts.section.showPast(2) })).toBeNull();
    expect(calls.some((c) => c.path === '/api/alerts?status=past')).toBe(false);

    await userEvent.click(toggle);
    const past = await screen.findByRole('table', { name: copy.alerts.section.showPast(2) });
    expect(rowOf(past, cleared.id)).toHaveTextContent(copy.alerts.section.cleared);
    expect(rowOf(past, cleared.id)).toHaveTextContent('Spend reset at midnight');
    expect(rowOf(past, dismissed.id)).toHaveTextContent(copy.alerts.section.dismissed);
    expect(within(past).queryByRole('button')).toBeNull();
  });
});

describe('board', () => {
  it('shows the bell only on a card with an active alert, and the strip above the board', async () => {
    const withAlert = aBoardCard({ number: 12, alertCount: 2 });
    const calm = aBoardCard({ number: 13, title: 'Fix edge routing' });
    stubFetch({
      '/api/board?forks=hide': anEmptyBoard({
        lanes: {
          not_reviewed: { cards: [], drafts: [] },
          agents_working: { cards: [] },
          action_needed: { cards: [withAlert, calm] },
          ready_to_merge: { cards: [] },
        },
      }),
      ...lists([failed, cost]),
    });
    renderApp('/prs');

    const strip = await screen.findByRole('status', { name: '' });
    await waitFor(() => expect(strip).toHaveTextContent(copy.alerts.count(2)));
    expect(within(strip).getByRole('link', { name: copy.alerts.strip.all })).toHaveAttribute(
      'href',
      '/activity',
    );
    expect(within(strip).getByRole('link', { name: /#142/ })).toHaveAttribute('href', '/pr/wb/142');

    const bells = document.querySelectorAll('[data-card-alert]');
    expect(bells).toHaveLength(1);
    expect(bells[0]!.closest('a, li')).toHaveTextContent('Add node grouping');
    expect(bells[0]).toHaveTextContent(copy.alerts.count(2));
  });

  it('shows no strip when nothing is active', async () => {
    stubFetch({ '/api/board?forks=hide': anEmptyBoard(), ...lists([]) });
    renderApp('/prs');
    await screen.findByRole('heading', { name: copy.board.title });
    await waitFor(() => expect(document.querySelector('[data-alert-strip]')).toBeNull());
  });
});

describe('status chip', () => {
  it.each([
    [0, null],
    [3, '3'],
  ])('shows %i active alerts', async (count, shown) => {
    stubFetch({
      '/api/status': aStatus({ activeAlertCount: count }),
      '/api/board?forks=hide': anEmptyBoard(),
      ...lists([]),
    });
    renderApp('/prs');
    const chip = await screen.findByRole('button', { name: /Running · \$1\.84 today/ });
    const segment = chip.querySelector('[data-chip-alerts]');
    if (shown === null) {
      expect(segment).toBeNull();
      expect(chip).not.toHaveAccessibleName(/active alert/);
    } else {
      expect(segment).toHaveTextContent(shown);
      expect(chip).toHaveAccessibleName(new RegExp(copy.alerts.count(count)));
    }
  });
});

describe('PR page', () => {
  it('a cost alert is a banner line with where it was posted, and Dismiss', async () => {
    const { calls } = stubFetch({
      '/api/prs/wb/12': aPrView({ alerts: [cost] }),
      '/api/prs/wb/12/findings': aFindingsResponse(),
      'POST /api/alerts/2/dismiss': { alert: { ...cost, status: 'dismissed', endedBy: 'hand' } },
    });
    renderApp('/pr/wb/12');

    const line = await waitFor(() => {
      const found = document.querySelector('[data-alert-line="cost"]');
      if (!found) throw new Error('no alert line');
      return found as HTMLElement;
    });
    expect(line).toHaveTextContent('Cost $5.40, above the $5.00 threshold · alert');
    expect(line).toHaveTextContent('Posted to ClickUp WB-123');
    expect(line).toHaveTextContent('5 min ago');
    await userEvent.click(within(line).getByRole('button', { name: copy.alerts.dismiss.action }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/alerts/2/dismiss')).toBe(
        true,
      ),
    );
  });

  it('says why nothing went to ClickUp, without Dismiss for a run-failed alert', async () => {
    stubFetch({
      '/api/prs/wb/12': aPrView({
        alerts: [
          {
            ...failed,
            delivery: {
              status: 'not_configured',
              taskId: null,
              toGeneralTask: false,
              reason: { code: 'alert_delivery_no_task', params: { forPr: true } },
              postedAt: null,
            },
          },
        ],
      }),
      '/api/prs/wb/12/findings': aFindingsResponse(),
    });
    renderApp('/pr/wb/12');
    const line = await waitFor(() => {
      const found = document.querySelector('[data-alert-line="failed"]');
      if (!found) throw new Error('no alert line');
      return found as HTMLElement;
    });
    expect(line).toHaveTextContent(
      'Alert · Not sent to ClickUp: no ClickUp task linked to this PR and no general alerts task',
    );
    expect(within(line).queryByRole('button')).toBeNull();
  });
});

describe('what happened to the ClickUp comment (ALERTTL)', () => {
  const delivery = (over: Partial<AlertView['delivery']>) =>
    copy.alerts.delivery({ ...failed.delivery, postedAt: null, ...over });

  it('names the reason when nothing was sent', () => {
    const notSent = (code: string, params: Record<string, unknown> = {}) =>
      delivery({ status: 'not_configured', taskId: null, reason: { code, params } });
    expect(notSent('alert_delivery_no_key', { missing: ['CLICKUP_API_KEY'] })).toBe(
      'Not sent to ClickUp: ClickUp not connected (CLICKUP_API_KEY is not set)',
    );
    expect(notSent('alert_delivery_no_app_url')).toBe(
      "Not sent to ClickUp: the app's address (APP_BASE_URL) is not set",
    );
    expect(notSent('alert_delivery_no_task', { forPr: true })).toBe(
      'Not sent to ClickUp: no ClickUp task linked to this PR and no general alerts task',
    );
    expect(notSent('alert_delivery_no_task', { forPr: false })).toBe(
      'Not sent to ClickUp: no general alerts task is set',
    );
    expect(notSent('alert_delivery_clickup_off')).toBe(
      'Not sent to ClickUp: no repository has ClickUp set up',
    );
  });

  it('an alert stored before reasons says what its row still shows', () => {
    expect(delivery({ status: 'not_configured', taskId: null, reason: null })).toBe(
      'Not sent to ClickUp: no ClickUp task to comment on',
    );
    expect(delivery({ status: 'not_configured', taskId: 'WB-9', reason: null })).toBe(
      'Not sent to ClickUp: ClickUp not configured',
    );
    // A failure without a reason no longer promises a retry.
    expect(delivery({ status: 'failed', taskId: 'WB-9', reason: null })).toBe(
      'Could not post to ClickUp WB-9',
    );
  });

  it('a failed attempt says whether it is tried again', () => {
    const failedWith = (willRetry: boolean, attempt: number) =>
      delivery({
        status: 'failed',
        taskId: 'WB-9',
        reason: {
          code: 'alert_delivery_failed',
          params: { willRetry, attempt, attempts: 6, errorCode: 'clickup_error' },
        },
      });
    expect(failedWith(true, 1)).toBe(
      'Could not post to ClickUp WB-9; trying again (attempt 1 of 6 failed)',
    );
    expect(failedWith(false, 6)).toBe('Could not post to ClickUp WB-9; gave up after 6 attempts');
  });

  it('Activity shows it in the row, under a column that only says when', async () => {
    stubFetch(
      lists([
        {
          ...failed,
          delivery: {
            status: 'not_configured',
            taskId: null,
            toGeneralTask: false,
            reason: { code: 'alert_delivery_no_task', params: { forPr: true } },
            postedAt: null,
          },
        },
      ]),
    );
    renderApp('/activity');
    const table = await screen.findByRole('table', { name: copy.alerts.section.title });
    expect(within(table).getByRole('columnheader', { name: 'When' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Posted' })).toBeNull();
    expect(table.querySelector('[data-alert-delivery="not_configured"]')).toHaveTextContent(
      'Not sent to ClickUp: no ClickUp task linked to this PR and no general alerts task',
    );
  });
});

it('a change of the alerts table refreshes Activity, the board, the PR view and the chip', () => {
  expect(targetsOf('alerts')).toEqual(['activity', 'board', 'prView', 'status']);
});
