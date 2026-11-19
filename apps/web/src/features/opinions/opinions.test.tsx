// S-08-T6: opinions on a finding: the team's, with names, comments and "from round N", the
// counts on its line, the draft buttons, who usually decides and decision labels with both names.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { OpinionView } from '@/lib/api-types.ts';
import { aDecision, aFinding, aFindingsResponse, anAuthor, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { clearReviewDrafts } from './draft.ts';

afterEach(() => {
  restoreFetch();
  clearReviewDrafts();
});

const KASIA = anAuthor({ login: 'kasia', name: 'Kasia', memberId: 'm-kasia' });

const opinion = (over: Partial<OpinionView>): OpinionView => ({
  id: 1,
  signedBy: { id: 'm-tomek', name: 'Tomek' },
  value: 'worth',
  comment: null,
  fromRound: 2,
  carried: false,
  at: '2026-11-19T12:00:00.000Z',
  ...over,
});

const reviewed = aFinding({
  id: 11,
  severity: 'blocking',
  title: 'Undo loses the group',
  usuallyDecidedBy: KASIA,
  opinions: [
    opinion({ id: 1, comment: 'Users hit this daily' }),
    opinion({
      id: 2,
      signedBy: { id: 'm-ola', name: 'Ola' },
      value: 'not_worth',
      fromRound: 1,
      carried: true,
    }),
  ],
});
const rejected = aFinding({
  id: 12,
  title: 'Labels overflow',
  decision: aDecision({
    decision: 'reject',
    reason: 'By design',
    signedBy: { id: 'm-tomek', name: 'Tomek' },
    author: KASIA,
  }),
});
const quiet = aFinding({ id: 13, title: 'Drag ignores the snap grid', usuallyDecidedBy: KASIA });

function stubPr() {
  return stubFetch({
    '/api/prs/wb/12': aPrView({ author: KASIA }),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings: [reviewed, rejected, quiet] }),
    '/api/team': { members: [] },
  });
}

async function openFinding(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }));
  return screen.getByRole('article', { name: new RegExp(title) });
}

test("the team's opinions are listed with names, comments and from round N", async () => {
  stubPr();
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const counts = await screen.findByTestId('opinion-counts');
  expect(counts).toHaveAccessibleName('Worth implementing: Tomek · Not worth it: Ola');

  const finding = await openFinding(user, 'Undo loses the group');
  expect(within(finding).getByText(copy.opinions.heading(2))).toBeVisible();
  const [tomek, ola] = within(within(finding).getByTestId('opinions')).getAllByRole('listitem');
  expect(tomek).toHaveTextContent('Tomek Worth implementing · “Users hit this daily”');
  expect(tomek).not.toHaveTextContent('from round');
  expect(ola).toHaveTextContent('Ola Not worth it · from round 1');
  expect(finding).toHaveTextContent('Usually decided by: Kasia (author)');
});

test('a finding without opinions says so; a decision names the signer and the author', async () => {
  stubPr();
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const finding = await openFinding(user, 'Labels overflow');
  expect(within(finding).getByText(copy.opinions.none)).toBeVisible();
  expect(within(finding).getByTestId('decided-by')).toHaveTextContent(
    'Rejected by Tomek (author: Kasia)',
  );
});

test('picking an opinion drafts it with a comment field; picking it again takes it back', async () => {
  stubPr();
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const finding = await openFinding(user, 'Drag ignores the snap grid');
  const worth = within(finding).getByRole('button', { name: 'Worth implementing' });
  await user.click(worth);
  expect(worth).toHaveAttribute('aria-pressed', 'true');
  expect(within(finding).getByText(copy.opinions.yourDraft)).toBeVisible();
  await user.type(within(finding).getByLabelText(copy.opinions.commentLabel), 'Cheap fix');
  expect(within(finding).getByLabelText(copy.opinions.commentLabel)).toHaveValue('Cheap fix');

  await user.click(worth);
  expect(worth).toHaveAttribute('aria-pressed', 'false');
  expect(within(finding).queryByText(copy.opinions.yourDraft)).toBeNull();
  expect(within(finding).queryByLabelText(copy.opinions.commentLabel)).toBeNull();
});
