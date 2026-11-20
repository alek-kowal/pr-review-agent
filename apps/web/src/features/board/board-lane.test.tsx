// S-17-T2: the Action needed lane follows the urgency order (FR-008), then age.
import type { PrState } from '@pra/core';
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aBoardCard, aNextStep, anEmptyBoard } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const URGENCY: PrState[] = [
  'stage_failed',
  'questions_waiting',
  'findings_to_decide',
  'sensitive_files',
  'patch_ready',
  'waiting_for_fix',
  'new_commits',
  'rounds_used',
];

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

async function actionNeeded() {
  const lane = await screen.findByRole('region', {
    name: new RegExp(`^${copy.board.lanes.action_needed.name}`),
  });
  return within(lane).getAllByRole('article');
}

test('one card of each state renders in the urgency order', async () => {
  // The api's order is the reverse, with the newest PR first.
  const cards = [...URGENCY]
    .reverse()
    .map((state, i) =>
      aBoardCard({ title: `PR in ${state}`, openedAt: daysAgo(i), nextStep: aNextStep({ state }) }),
    );
  stubFetch({
    '/api/board?forks=hide': anEmptyBoard({
      lanes: { ...anEmptyBoard().lanes, action_needed: { cards } },
    }),
  });
  renderApp('/prs');
  expect((await actionNeeded()).map((card) => card.dataset.state)).toEqual(URGENCY);
});

test('cards of the same state come longest waiting first', async () => {
  const decide = (title: string, days: number) =>
    aBoardCard({ title, openedAt: daysAgo(days), nextStep: aNextStep() });
  stubFetch({
    '/api/board?forks=hide': anEmptyBoard({
      lanes: {
        ...anEmptyBoard().lanes,
        action_needed: { cards: [decide('Newest', 1), decide('Oldest', 9), decide('Middle', 4)] },
      },
    }),
  });
  renderApp('/prs');
  const titles = (await actionNeeded()).map((card) => within(card).getByRole('link').textContent);
  expect(titles).toEqual(['Oldest', 'Middle', 'Newest']);
});

test('the Action needed lane spans two columns and lays its cards out in two', async () => {
  stubFetch({
    '/api/board?forks=hide': anEmptyBoard({
      lanes: { ...anEmptyBoard().lanes, action_needed: { cards: [aBoardCard()] } },
    }),
  });
  renderApp('/prs');
  const [card] = await actionNeeded();
  const list = card!.closest('ul')!;
  expect(list.className).toContain('grid-cols-2');
  expect(list.closest('[data-lane]')!.parentElement!.className).toContain('2fr');
});
