// S-17-T1: full board cards and the compact forms (FR-006, FR-009).
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aBoardCard, aNextStep, anAuthor, anEmptyBoard } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const readyStep = aNextStep({
  state: 'ready_to_merge',
  lane: 'ready_to_merge',
  tone: 'ready',
  banner: { code: 'state_ready_to_merge', params: { sha: 'abc1234def' } },
});
const mergedStep = aNextStep({
  state: 'merged',
  lane: null,
  tone: 'neutral',
  banner: { code: 'state_merged', params: {} },
});

async function cardTitled(title: string) {
  const link = await screen.findByRole('link', { name: title });
  return link.closest('article')!;
}

test('the default repository, level and round are hidden, and non-default ones are shown', async () => {
  stubFetch({
    '/api/board': anEmptyBoard({
      repositoryCount: 2,
      lanes: {
        ...anEmptyBoard().lanes,
        action_needed: {
          cards: [
            aBoardCard({ number: 1, title: 'Plain one' }),
            aBoardCard({
              number: 2,
              title: 'Unusual one',
              repository: { slug: 'docs-site' },
              level: { number: 4, repositoryDefault: 2 },
              round: { number: 2, max: 3 },
              isFork: true,
            }),
          ],
        },
      },
    }),
  });
  renderApp('/prs');

  const unusual = await cardTitled('Unusual one');
  expect(unusual).toHaveTextContent('docs-site');
  expect(unusual).toHaveTextContent(copy.board.round(2, 3));
  expect(unusual).toHaveTextContent(copy.board.level(4));
  expect(within(unusual).getByTitle(copy.board.levelTitle(4, 2))).toBeInTheDocument();
  expect(within(unusual).getByTitle(copy.board.forkTitle)).toBeInTheDocument();

  const plain = await cardTitled('Plain one');
  expect(plain).not.toHaveTextContent(copy.board.level(2));
  expect(plain).not.toHaveTextContent('round');
  expect(within(plain).queryByTitle(copy.board.forkTitle)).toBeNull();
});

test('the default repository is hidden when only one is connected', async () => {
  stubFetch({
    '/api/board': anEmptyBoard({
      lanes: {
        ...anEmptyBoard().lanes,
        action_needed: { cards: [aBoardCard({ title: 'Only repo', repository: { slug: 'wb' } })] },
      },
    }),
  });
  renderApp('/prs');
  expect(await cardTitled('Only repo')).not.toHaveTextContent('wb');
});

test('a 40-character author name renders in full on a 280 px card; the round label shortens', async () => {
  const name = 'Konstantynopolitańczykowianeczka Nowaków';
  expect(name).toHaveLength(40);
  stubFetch({
    '/api/board': anEmptyBoard({
      lanes: {
        ...anEmptyBoard().lanes,
        action_needed: {
          cards: [
            aBoardCard({
              title: 'Long author',
              author: anAuthor({ name, login: 'long-gh', memberId: 'm-9' }),
              round: { number: 3, max: 3 },
            }),
          ],
        },
      },
    }),
  });
  renderApp('/prs');
  const card = await cardTitled('Long author');
  card.style.width = '280px';

  const author = card.querySelector('[data-author]')!;
  expect(author.textContent).toBe(name);
  // Neither the name nor its wrapper may shrink or clip; the round label may.
  for (const element of [author, author.parentElement!]) {
    expect(element.className).not.toMatch(/truncate|line-clamp|text-ellipsis/);
  }
  expect(author.parentElement!.className).toContain('shrink-0');
  const round = card.querySelector('[data-round]')!;
  expect(round.className).toContain('truncate');
  expect(round.parentElement!.className).toContain('min-w-0');
});

test('a Ready to merge card has two lines', async () => {
  stubFetch({
    '/api/board': anEmptyBoard({
      lanes: {
        ...anEmptyBoard().lanes,
        ready_to_merge: { cards: [aBoardCard({ title: 'Ready one', nextStep: readyStep })] },
        action_needed: { cards: [aBoardCard({ title: 'Needs a call' })] },
      },
    }),
  });
  renderApp('/prs');
  expect((await cardTitled('Ready one')).children).toHaveLength(2);
  expect((await cardTitled('Needs a call')).children).toHaveLength(3);
});

test('drafts render as rows under "3 drafts"', async () => {
  const draftStep = aNextStep({ state: 'draft', lane: 'not_reviewed', tone: 'neutral' });
  const drafts = ['WIP one', 'WIP two', 'WIP three'].map((title) =>
    aBoardCard({ title, isDraft: true, nextStep: draftStep }),
  );
  stubFetch({
    '/api/board': anEmptyBoard({
      lanes: { ...anEmptyBoard().lanes, not_reviewed: { cards: [], drafts } },
    }),
  });
  renderApp('/prs');
  const list = await screen.findByRole('list', { name: copy.board.drafts(3) });
  expect(screen.getByRole('heading', { name: '3 drafts' })).toBeInTheDocument();
  const rows = within(list).getAllByRole('listitem');
  expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
    'WIP one',
    'WIP two',
    'WIP three',
  ]);
  for (const row of rows) expect(within(row).queryByRole('article')).toBeNull();
});

test('the merged/closed list starts collapsed and shows its count', async () => {
  stubFetch({
    '/api/board': anEmptyBoard({
      mergedOrClosed: [
        aBoardCard({ title: 'Merged one', nextStep: mergedStep }),
        aBoardCard({ title: 'Merged two', nextStep: mergedStep }),
      ],
    }),
  });
  renderApp('/prs');
  const summary = await screen.findByText(copy.board.mergedOrClosed);
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(summary.closest('summary')).toHaveTextContent('2');
});
