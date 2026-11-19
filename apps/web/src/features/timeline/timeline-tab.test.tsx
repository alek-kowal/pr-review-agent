import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import { dateTime } from '@/copy/format.ts';
import type { TimelineResponse } from '@/lib/api-types.ts';
import { aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const HOUR = 3_600_000;

// A merged PR: ready at 9:00, merged 5 h later; agents worked 1 h 30 min, people 3 h 30 min.
const TIMELINE: TimelineResponse = {
  summary: {
    readyAt: '2026-11-19T09:00:00.000Z',
    outcome: 'merged',
    totalMs: 5 * HOUR,
    agentsWorkedMs: 1.5 * HOUR,
    waitingMs: 3.5 * HOUR,
    byLane: { agents: 1.5 * HOUR, people: 3.5 * HOUR },
    costUsd: 1.84,
  },
  entries: [
    {
      id: 1,
      at: '2026-11-19T09:00:00.000Z',
      actor: { kind: 'hand' },
      memberName: null,
      kind: 'pr_ready',
      params: { via: 'github' },
      runId: null,
      costUsd: null,
    },
    {
      id: 2,
      at: '2026-11-19T10:30:00.000Z',
      actor: { kind: 'bot' },
      memberName: null,
      kind: 'run_finished',
      params: { runKind: 'round', roundNumber: 1 },
      runId: 41,
      costUsd: 1.84,
    },
    {
      id: 3,
      at: '2026-11-19T11:00:00.000Z',
      actor: { kind: 'member', memberId: 'm-anna' },
      memberName: 'Anna Nowak',
      kind: 'findings_decided',
      params: { count: 2, decision: 'reject', reason: 'out of scope' },
      runId: null,
      costUsd: null,
    },
  ],
};

const openTimeline = () => {
  stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/prs/wb/12/timeline': TIMELINE,
  });
  renderApp('/pr/wb/12?tab=timeline');
};

const entryFor = async (kind: string) => {
  const list = await screen.findByRole('list', { name: copy.timeline.entriesLabel });
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => li.dataset.entry === kind);
  if (!item) throw new Error(`no ${kind} entry`);
  return item;
};

describe('PR Timeline tab', () => {
  it('summary values match the API answer', async () => {
    openTimeline();

    const summary = await screen.findByTestId('time-summary');
    const value = (label: string) =>
      within(summary).getByText(label).nextElementSibling?.textContent;
    expect(value(copy.timeline.readyAt)).toBe(dateTime(TIMELINE.summary.readyAt!));
    expect(value(copy.timeline.total.merged)).toBe('5 h');
    expect(value(copy.timeline.agentsWorked)).toBe('1 h 30 min');
    expect(value(copy.timeline.waiting)).toBe('3 h 30 min');
    expect(value(copy.timeline.cost)).toBe('$1.84');
  });

  it('member, bot and hand entries show the right actor text', async () => {
    openTimeline();

    const member = await entryFor('findings_decided');
    expect(within(member).getByTestId('entry-actor')).toHaveTextContent('Anna Nowak');
    expect(member).toHaveTextContent('Decided 2 findings: reject (out of scope)');

    const bot = await entryFor('run_finished');
    expect(within(bot).getByTestId('entry-actor')).toHaveTextContent(copy.timeline.actor.bot);
    expect(within(bot).getByTestId('entry-cost')).toHaveTextContent('$1.84');
    expect(within(bot).getByRole('link', { name: copy.runs.runDetails })).toHaveAttribute(
      'href',
      '/runs/41',
    );

    const hand = await entryFor('pr_ready');
    expect(within(hand).getByTestId('entry-actor')).toHaveTextContent(copy.timeline.actor.hand);
    expect(hand).toHaveTextContent(copy.timeline.inGitHub);
  });

  it('lists entries newest first and filters by who acted', async () => {
    openTimeline();
    const user = userEvent.setup();

    const list = await screen.findByRole('list', { name: copy.timeline.entriesLabel });
    const kinds = () =>
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.dataset.entry);
    expect(kinds()).toEqual(['findings_decided', 'run_finished', 'pr_ready']);

    await user.click(screen.getByRole('button', { name: copy.timeline.filters.bot }));
    expect(kinds()).toEqual(['run_finished']);
    await user.click(screen.getByRole('button', { name: copy.timeline.filters.people }));
    expect(kinds()).toEqual(['findings_decided', 'pr_ready']);
  });

  it('P-11 entries read as sentences, not their kind', () => {
    const { entries } = copy.timeline;
    const context = { stage: String, reason: String };
    expect(entries.pr_level_changed!({ from: null, to: 3 }, context)).toBe(
      'PR level set to level 3 (was the repository default)',
    );
    expect(entries.sensitive_approved!({ count: 2, files: ['a', 'b'] }, context)).toBe(
      'Approved 2 sensitive files',
    );
    expect(
      entries.sensitive_sent_back!({ count: 1, files: ['a'], comment: 'Split it' }, context),
    ).toBe('Sent back 1 sensitive file: "Split it"');
  });

  it('reconcile poll entries name what GitHub corrected', () => {
    const { entries } = copy.timeline;
    const context = { stage: String, reason: String };
    expect(entries.pr_reconciled!({ corrections: ['imported'] }, context)).toBe(
      'Imported from GitHub',
    );
    expect(
      entries.pr_reconciled!({ corrections: ['head', 'closed'], headSha: 'b'.repeat(40) }, context),
    ).toBe('Corrected from GitHub: head bbbbbbb, closed');
  });
});
