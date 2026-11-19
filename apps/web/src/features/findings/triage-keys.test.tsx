import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { TeamMember } from '@/lib/api-types.ts';
import { clearReviewDrafts } from '@/features/opinions/draft.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import {
  aChecklist,
  aDecision,
  aFinding,
  aFindingsResponse,
  aNextStep,
  aPrView,
} from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};
// Shown order: the blocking ones first, then worth fixing.
const third = aFinding({ id: 13, severity: 'worth_fixing', title: 'Labels overflow' });
const first = aFinding({ id: 11, severity: 'blocking', title: 'Undo loses the group' });
const second = aFinding({ id: 12, severity: 'blocking', title: 'Drag ignores the snap grid' });
const FINDINGS = [third, first, second];

const scrolled = vi.fn();

function stub() {
  return stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings: FINDINGS }),
    '/api/team': { members: [kasia] },
    'POST /api/prs/wb/12/decisions': {
      batchId: 'b-1',
      nextStep: aNextStep(),
      checklist: aChecklist(),
      findings: aFindingsResponse({
        findings: [
          third,
          { ...first, decision: aDecision({ signedBy: { id: kasia.id, name: 'Kasia' } }) },
          second,
        ],
      }),
    },
  });
}

// `hidden`: an open dialog hides the page from the accessibility tree.
const article = (title: string) =>
  screen.getByRole('article', { name: new RegExp(title), hidden: true });
const lineOf = (title: string) => within(article(title)).getAllByRole('button')[0]!;

beforeEach(() => {
  window.localStorage.setItem(LAST_SIGNER_KEY, kasia.id);
  Element.prototype.scrollIntoView = scrolled;
});
afterEach(() => {
  restoreFetch();
  clearReviewDrafts();
  window.localStorage.clear();
  scrolled.mockClear();
});

async function onFindings(path = '/pr/wb/12') {
  const { calls } = stub();
  const user = userEvent.setup();
  const app = renderApp(path);
  await screen.findByRole('article', { name: /Undo loses the group/ });
  return { user, calls, ...app };
}

test('j and k move the focused finding in the shown order and scroll it into view', async () => {
  const { user } = await onFindings();

  await user.keyboard('j');
  expect(lineOf('Undo loses the group')).toHaveFocus();
  expect(article('Undo loses the group')).toHaveAttribute('data-current');
  expect(scrolled.mock.contexts.at(-1)).toBe(article('Undo loses the group'));

  await user.keyboard('jj');
  expect(lineOf('Labels overflow')).toHaveFocus();
  await user.keyboard('j');
  expect(lineOf('Labels overflow')).toHaveFocus();

  await user.keyboard('k');
  expect(lineOf('Drag ignores the snap grid')).toHaveFocus();
  expect(scrolled.mock.contexts.at(-1)).toBe(article('Drag ignores the snap grid'));
  expect(article('Undo loses the group')).not.toHaveAttribute('data-current');
});

test('o expands and collapses; x selects; pressing w twice clears the opinion draft', async () => {
  const { user } = await onFindings();

  await user.keyboard('jo');
  expect(lineOf('Undo loses the group')).toHaveAttribute('aria-expanded', 'true');
  const worth = within(article('Undo loses the group')).getByRole('button', {
    name: copy.opinions.values.worth,
  });

  await user.keyboard('w');
  expect(worth).toHaveAttribute('aria-pressed', 'true');
  await user.keyboard('w');
  expect(worth).toHaveAttribute('aria-pressed', 'false');
  await user.keyboard('n');
  expect(
    within(article('Undo loses the group')).getByRole('button', {
      name: copy.opinions.values.not_worth,
    }),
  ).toHaveAttribute('aria-pressed', 'true');

  await user.keyboard('x');
  expect(
    within(article('Undo loses the group')).getByRole('checkbox', { name: /Undo loses/ }),
  ).toBeChecked();

  await user.keyboard('o');
  expect(lineOf('Undo loses the group')).toHaveAttribute('aria-expanded', 'false');
});

test('i opens the Implement form with the signature prefilled, and Enter confirms', async () => {
  const { user, calls } = await onFindings();

  await user.keyboard('ji');
  const form = await screen.findByRole('form', {
    name: copy.decisions.formTitle('implement', 1),
  });
  expect(article('Undo loses the group')).toContainElement(form);
  await waitFor(() => expect(within(form).getByRole('combobox')).toHaveTextContent('Kasia'));

  expect(within(form).getByRole('button', { name: /^Implement/ })).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect((posts[0] as { body?: unknown }).body).toMatchObject({
    findingIds: [11],
    decision: 'implement',
    signedBy: kasia.id,
  });
});

test('keys typed inside a textarea do nothing', async () => {
  const { user } = await onFindings();

  await user.keyboard('jr');
  const reason = await screen.findByRole('textbox', { name: copy.decisions.reason.reject });
  expect(reason).toHaveFocus();
  await user.keyboard('jkoxwid');

  expect(reason).toHaveValue('jkoxwid');
  expect(article('Undo loses the group')).toHaveAttribute('data-current');
  expect(lineOf('Undo loses the group')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('form')).toHaveLength(1);
});

test('? opens the shortcut list, and keys wait while it is open', async () => {
  const { user } = await onFindings();

  await user.keyboard('?');
  const list = await screen.findByRole('dialog', { name: copy.shortcuts.title });
  expect(within(list).getByText(copy.shortcuts.items.goActivity)).toBeVisible();
  expect(within(list).getByText(copy.shortcuts.items.implement)).toBeVisible();

  await user.keyboard('j');
  expect(article('Undo loses the group')).not.toHaveAttribute('data-current');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('g a goes to Activity and g p to Pull requests', async () => {
  const { user, router } = await onFindings();

  await user.keyboard('ga');
  await waitFor(() => expect(router.state.location.pathname).toBe('/activity'));
  await user.keyboard('gp');
  await waitFor(() => expect(router.state.location.pathname).toBe('/prs'));
});
