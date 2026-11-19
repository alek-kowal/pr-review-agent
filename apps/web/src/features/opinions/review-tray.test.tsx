// S-08-T6: the review tray: drafted opinions saved as one signed review.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { ReviewResponse, TeamMember } from '@/lib/api-types.ts';
import {
  aChecklist,
  aFinding,
  aFindingsResponse,
  aNextStep,
  anAuthor,
  aPrView,
} from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { clearReviewDrafts } from './draft.ts';

afterEach(() => {
  restoreFetch();
  clearReviewDrafts();
  window.localStorage.clear();
});

const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const FINDINGS = [
  aFinding({ id: 11, severity: 'blocking', title: 'Undo loses the group' }),
  aFinding({ id: 12, severity: 'blocking', title: 'Drag ignores the snap grid' }),
  aFinding({ id: 13, severity: 'nit', title: 'Rename the helper' }),
];

const saved: ReviewResponse = {
  review: {
    id: 5,
    signedBy: { id: tomek.id, name: 'Tomek' },
    worth: 2,
    notWorth: 1,
    createdAt: '2026-11-19T12:00:00.000Z',
  },
  nextStep: aNextStep(),
  checklist: aChecklist(),
  findings: aFindingsResponse({
    findings: FINDINGS.map((f) => ({
      ...f,
      opinions: [
        {
          id: f.id,
          signedBy: { id: tomek.id, name: 'Tomek' },
          value: f.id === 12 ? 'not_worth' : 'worth',
          comment: null,
          fromRound: 1,
          carried: false,
          at: '2026-11-19T12:00:00.000Z',
        },
      ],
    })),
  }),
};

function stubPr() {
  return stubFetch({
    '/api/prs/wb/12': aPrView({ author: anAuthor({ login: 'kasia', name: 'Kasia' }) }),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings: FINDINGS }),
    '/api/team': { members: [tomek] },
    'POST /api/prs/wb/12/reviews': saved,
  });
}

async function draft(user: ReturnType<typeof userEvent.setup>, title: string, value: string) {
  const article = screen.getByRole('article', { name: new RegExp(title) });
  if (!within(article).queryByRole('button', { name: value })) {
    await user.click(within(article).getByRole('button', { name: new RegExp(title) }));
  }
  await user.click(within(article).getByRole('button', { name: value }));
  return article;
}

test('3 opinions show in the tray and save as one signed review', async () => {
  const { calls } = stubPr();
  const user = userEvent.setup();
  renderApp('/pr/wb/12');
  await screen.findByRole('article', { name: /Undo loses the group/ });
  expect(screen.queryByRole('region', { name: copy.opinions.tray.label })).toBeNull();

  const first = await draft(user, 'Undo loses the group', 'Worth implementing');
  await user.type(within(first).getByLabelText(copy.opinions.commentLabel), 'Users hit this');
  await draft(user, 'Drag ignores the snap grid', 'Not worth it');
  await draft(user, 'Rename the helper', 'Worth implementing');

  const tray = screen.getByRole('region', { name: copy.opinions.tray.label });
  expect(tray).toHaveTextContent('Your review: 3 opinions');
  expect(tray).toHaveTextContent('2 worth implementing, 1 not worth it');

  await user.click(within(tray).getByRole('button', { name: copy.opinions.tray.save }));
  const dialog = await screen.findByRole('dialog', { name: copy.opinions.dialog.title });
  expect(dialog).toHaveTextContent('Kasia sees it before deciding');
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);

  // No signer yet: nothing is sent.
  await user.click(within(dialog).getByRole('button', { name: copy.opinions.dialog.submit }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(copy.signature.required);

  await user.click(within(dialog).getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: /Tomek/ }));
  await user.click(within(dialog).getByRole('button', { name: copy.opinions.dialog.submit }));

  await waitFor(() =>
    expect(screen.queryByRole('region', { name: copy.opinions.tray.label })).toBeNull(),
  );
  const posts = calls.filter((c) => c.method === 'POST' && c.path === '/api/prs/wb/12/reviews');
  expect(posts).toHaveLength(1);
  expect((posts[0] as { body?: unknown }).body).toEqual({
    opinions: [
      { findingId: 11, value: 'worth', comment: 'Users hit this' },
      { findingId: 12, value: 'not_worth' },
      { findingId: 13, value: 'worth' },
    ],
    signedBy: tomek.id,
  });
  expect(await screen.findByText("Tomek's review saved")).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Discard empties the tray without sending anything', async () => {
  const { calls } = stubPr();
  const user = userEvent.setup();
  renderApp('/pr/wb/12');
  await screen.findByRole('article', { name: /Undo loses the group/ });

  await draft(user, 'Undo loses the group', 'Worth implementing');
  const tray = screen.getByRole('region', { name: copy.opinions.tray.label });
  expect(tray).toHaveTextContent('Your review: 1 opinion');
  await user.click(within(tray).getByRole('button', { name: copy.opinions.tray.discard }));

  expect(screen.queryByRole('region', { name: copy.opinions.tray.label })).toBeNull();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});
