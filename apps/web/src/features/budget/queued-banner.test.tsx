// S-10-T6: a PR queued by a pause, the daily budget or busy agent slots says why, on the PR page,
// on its board card and in Activity; Resume… opens the status chip.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import { clockOrDate, dateTime } from '@/copy/format.ts';
import type { InProgressRun, NextStepView, StatusResponse } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import {
  aBoardCard,
  aFindingsResponse,
  aNextStep,
  anEmptyBoard,
  aPrView,
  aStatus,
} from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const tomek = { id: 'm-tomek', name: 'Tomek' };
const PAUSED = aStatus({
  state: 'paused',
  pausedBy: tomek,
  pausedReason: 'release freeze',
  pausedAt: '2026-11-19T09:30:00.000Z',
});
const BUDGET = aStatus({ state: 'budget_reached', todaySpendUsd: 50.2, dailyBudgetUsd: 50 });
/** Not today, so the pause names the date too. */
const UNTIL = '2026-01-20T14:01:00.000Z';

const resume = { action: 'resume' as const, signed: true, optional: false, disabled: null };
const cancel = { action: 'cancel' as const, signed: false, optional: false, disabled: null };

const queued = (banner: NextStepView['banner'], paused: boolean): NextStepView =>
  aNextStep({
    state: 'queued',
    lane: 'agents_working',
    tone: 'working',
    banner,
    who: paused
      ? { code: 'who_anyone_can_resume', params: {} }
      : { code: 'who_starts_by_itself', params: {} },
    mainAction: { ...(paused ? resume : cancel), stage: null },
  });

const FIXTURES: { name: string; status: StatusResponse; step: NextStepView; title: string }[] = [
  {
    name: 'paused',
    status: PAUSED,
    step: queued(
      {
        code: 'state_queued_paused',
        params: { by: { kind: 'member', memberId: tomek.id }, note: 'release freeze' },
      },
      true,
    ),
    title: 'Queued: paused by Tomek (release freeze)',
  },
  {
    name: 'budget',
    status: BUDGET,
    step: queued({ code: 'state_queued_budget', params: { spentUsd: 50.2, budgetUsd: 50 } }, true),
    title: 'Queued: daily budget reached ($50.20 of $50.00)',
  },
  {
    name: 'slots',
    status: aStatus({ agentSlots: 2, queuedCount: 1 }),
    step: queued({ code: 'state_queued_slot', params: {} }, false),
    title: 'Queued: waiting for a free agent slot',
  },
  {
    name: 'usage limit (P-25)',
    status: aStatus({ modelAuth: 'subscription' }),
    step: queued({ code: 'state_queued_usage_limit', params: { until: UNTIL } }, false),
    title: `Paused until ${dateTime(UNTIL)}: Claude usage limit`,
  },
];

describe('PR page banner', () => {
  it.each(FIXTURES)('$name: "$title"', async ({ status, step, title }) => {
    stubFetch({
      '/api/status': status,
      '/api/prs/wb/12': aPrView({ nextStep: step }),
      '/api/prs/wb/12/findings': aFindingsResponse(),
    });
    renderApp('/pr/wb/12');
    expect(await screen.findByText(title)).toBeVisible();
  });

  it('Resume… opens the status chip, where the factory is resumed', async () => {
    stubFetch({
      '/api/status': PAUSED,
      '/api/prs/wb/12': aPrView({ nextStep: FIXTURES[0]!.step }),
      '/api/prs/wb/12/findings': aFindingsResponse(),
      '/api/team': { members: [] },
    });
    renderApp('/pr/wb/12');
    await userEvent.click(
      await screen.findByRole('button', { name: copy.nextStep.actions.resume }),
    );
    const panel = await screen.findByRole('group', { name: copy.status.label });
    expect(within(panel).getByRole('button', { name: /Resume/ })).toBeVisible();
  });
});

describe('board card', () => {
  it.each(FIXTURES)('$name: in Agents working with "$title"', async ({ status, step, title }) => {
    stubFetch({
      '/api/status': status,
      '/api/board?forks=hide': anEmptyBoard({
        lanes: {
          ...anEmptyBoard().lanes,
          agents_working: { cards: [aBoardCard({ number: 12, nextStep: step })] },
        },
      }),
    });
    renderApp('/prs');
    const card = (await screen.findByText(title)).closest('article');
    expect(card).toHaveAttribute('data-state', 'queued');
  });
});

describe('Activity row', () => {
  const run = (wait: InProgressRun['wait']): InProgressRun => ({
    id: 51,
    kind: 'round',
    status: 'queued',
    roundNumber: 1,
    level: { number: 1, key: 'diff' },
    currentStage: null,
    costUsd: 0,
    wait,
    createdAt: '2026-11-19T10:00:00.000Z',
    startedAt: null,
    pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
  });

  it.each([
    {
      name: 'paused',
      status: PAUSED,
      wait: {
        code: 'paused',
        params: { by: { kind: 'member', memberId: tomek.id }, note: 'release freeze' },
      },
      text: 'Queued: paused by Tomek (release freeze)',
    },
    {
      name: 'budget',
      status: BUDGET,
      wait: { code: 'budget_reached', params: { spentUsd: 50.2, budgetUsd: 50 } },
      text: 'Queued: daily budget reached ($50.20 of $50.00)',
    },
    {
      name: 'slots',
      status: aStatus(),
      wait: { code: 'slots_busy', params: { slots: 2, prs: [13, 14] } },
      text: 'Queued: 2 agent slots busy (#13, #14)',
    },
    {
      name: 'usage limit',
      status: aStatus({ modelAuth: 'subscription' }),
      wait: { code: 'usage_limit_reached', params: { until: UNTIL, resetsAt: null } },
      text: `Paused until ${dateTime(UNTIL)}: Claude usage limit`,
    },
  ])('$name: "$text"', async ({ status, wait, text }) => {
    stubFetch({ '/api/status': status, '/api/activity/in-progress': { runs: [run(wait)] } });
    renderApp('/activity');
    const table = await screen.findByRole('table', { name: copy.activity.inProgress.title });
    expect(await within(table).findByText(text)).toBeVisible();
  });
});

describe('the usage limit pause time', () => {
  it('is a clock time today and a date with the time otherwise', () => {
    const now = new Date('2026-11-19T12:00:00');
    expect(clockOrDate(new Date('2026-11-19T15:01:00').toISOString(), now)).toBe('15:01');
    expect(clockOrDate(new Date('2026-11-20T09:05:00').toISOString(), now)).toBe('20 Nov, 09:05');
  });
});
