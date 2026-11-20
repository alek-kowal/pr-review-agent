import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aBoardCard, aNextStep, anAuthor, anEmptyBoard } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const lane = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });

const decide = aBoardCard({
  number: 12,
  title: 'Add node grouping',
  author: anAuthor({ login: 'kasia-gh', name: 'Kasia', memberId: 'm-1' }),
});
const failed = aBoardCard({
  number: 13,
  title: 'Fix the edge labels',
  nextStep: aNextStep({
    state: 'stage_failed',
    tone: 'failed',
    banner: {
      code: 'state_stage_failed',
      params: { stage: 'review', errorCode: 'stage_timeout', timeoutMinutes: 20, roundNumber: 1 },
    },
    who: { code: 'who_anyone_can_retry', params: {} },
  }),
});
const running = aBoardCard({
  number: 14,
  title: 'Speed up layout',
  nextStep: aNextStep({
    state: 'round_running',
    lane: 'agents_working',
    tone: 'working',
    banner: { code: 'state_round_starting', params: { roundNumber: 1, max: 3 } },
    who: { code: 'who_no_one_needs_to_act', params: {} },
  }),
});
const never = aBoardCard({
  number: 15,
  title: 'Add a minimap',
  nextStep: aNextStep({
    state: 'never_reviewed',
    lane: 'not_reviewed',
    tone: 'neutral',
    banner: { code: 'state_never_reviewed', params: { fork: false } },
    who: { code: 'who_anyone_can_start', params: {} },
  }),
});
const draft = aBoardCard({
  number: 16,
  title: 'WIP: dark theme',
  isDraft: true,
  nextStep: aNextStep({ state: 'draft', lane: 'not_reviewed', tone: 'neutral' }),
});
const ready = aBoardCard({
  number: 17,
  title: '<script>alert(1)</script> Ready one',
  nextStep: aNextStep({
    state: 'ready_to_merge',
    lane: 'ready_to_merge',
    tone: 'ready',
    banner: { code: 'state_ready_to_merge', params: { sha: 'abc1234def' } },
  }),
});
const merged = aBoardCard({
  number: 18,
  title: 'Old work',
  nextStep: aNextStep({
    state: 'merged',
    lane: null,
    tone: 'neutral',
    banner: { code: 'state_merged', params: { by: null } },
    who: { code: 'who_nobody', params: {} },
    mainAction: null,
  }),
});

const fixture = anEmptyBoard({
  lanes: {
    not_reviewed: { cards: [never], drafts: [draft] },
    agents_working: { cards: [running] },
    action_needed: { cards: [failed, decide] },
    ready_to_merge: { cards: [ready] },
  },
  mergedOrClosed: [merged],
});

test('each PR is in its lane, with the Action needed count', async () => {
  stubFetch({ '/api/board?forks=hide': fixture });
  renderApp('/prs');
  const action = await screen.findByRole('region', {
    name: new RegExp(`^${copy.board.lanes.action_needed.name}`),
  });
  expect(within(action).getByLabelText(copy.board.count(2))).toHaveTextContent('2');
  const cards = within(action).getAllByRole('article');
  expect(cards.map((c) => within(c).getByRole('link').textContent)).toEqual([
    'Fix the edge labels',
    'Add node grouping',
  ]);
  // Third line: the next step; "usually … (author)" is left out on cards.
  expect(cards[1]).toHaveTextContent('Decide 3 findings');
  expect(cards[1]).not.toHaveTextContent('usually');
  expect(cards[1]).toHaveTextContent('#12');
  expect(cards[1]).toHaveTextContent('Kasia');
  expect(cards[1]).toHaveTextContent('3d');
  expect(cards[0]).toHaveTextContent('Review stage failed · anyone can retry');
  expect(within(cards[1]!).getByRole('link')).toHaveAttribute('href', '/pr/wb/12');

  const working = lane(copy.board.lanes.agents_working.name);
  expect(within(working).getByRole('article')).toHaveTextContent('Round 1 of 3 is running');
  const notReviewed = lane(copy.board.lanes.not_reviewed.name);
  expect(within(notReviewed).getByRole('article')).toHaveTextContent(
    'Start a review · anyone can start it',
  );
  // The repository shows only when there is more than one.
  expect(cards[1]).not.toHaveTextContent('wb');
});

test('drafts are one-line rows under "N drafts" in Not reviewed', async () => {
  stubFetch({ '/api/board?forks=hide': fixture });
  renderApp('/prs');
  const notReviewed = await screen.findByRole('region', {
    name: new RegExp(`^${copy.board.lanes.not_reviewed.name}`),
  });
  const rows = within(notReviewed).getByRole('list', { name: copy.board.drafts(1) });
  const row = within(rows).getByRole('listitem');
  expect(row).toHaveTextContent('WIP: dark theme');
  expect(within(row).queryByRole('article')).toBeNull();
  expect(within(notReviewed).getByLabelText(copy.board.count(2))).toBeInTheDocument();
});

test('a title containing markup renders as text (P sync.test.ts 82)', async () => {
  stubFetch({ '/api/board?forks=hide': fixture });
  const { container } = renderApp('/prs');
  const readyLane = await screen.findByRole('region', {
    name: new RegExp(`^${copy.board.lanes.ready_to_merge.name}`),
  });
  expect(within(readyLane).getByRole('link')).toHaveTextContent(
    '<script>alert(1)</script> Ready one',
  );
  expect(container.querySelector('script')).toBeNull();
  // Ready to merge cards are two lines: no next step line.
  expect(within(readyLane).getByRole('article')).not.toHaveTextContent('Merge when');
});

test('empty lanes say so, and merged or closed PRs are a collapsed list', async () => {
  stubFetch({
    '/api/board?forks=hide': anEmptyBoard({ mergedOrClosed: [merged], repositoryCount: 2 }),
  });
  renderApp('/prs');
  await screen.findByText(copy.board.lanes.action_needed.empty);
  for (const name of ['not_reviewed', 'agents_working', 'ready_to_merge'] as const) {
    expect(screen.getByText(copy.board.lanes[name].empty)).toBeInTheDocument();
  }
  const summary = screen.getByText(copy.board.mergedOrClosed);
  const link = screen.getByRole('link', { name: 'Old work', hidden: true });
  expect(link).not.toBeVisible();
  await userEvent.click(summary);
  expect(link).toBeVisible();
  expect(screen.getByRole('row', { name: /Old work/ })).toHaveTextContent('Merged');
});

test('with several repositories a card shows its repository', async () => {
  stubFetch({
    '/api/board?forks=hide': anEmptyBoard({
      lanes: { ...anEmptyBoard().lanes, action_needed: { cards: [decide] } },
      repositoryCount: 2,
    }),
  });
  renderApp('/prs');
  const card = await screen.findByRole('article');
  expect(card).toHaveTextContent('#12·wb·Kasia');
});

test('an api failure shows its copy', async () => {
  stubFetch({});
  renderApp('/prs');
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.unknownError('not_stubbed'));
});
