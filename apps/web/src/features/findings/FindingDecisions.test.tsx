import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { DecideResponse, DecisionView, FindingView, TeamMember } from '@/lib/api-types.ts';
import { prKeys } from '@/features/pr/queries.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import {
  aChecklist,
  aDecision,
  aFinding,
  aFindingsResponse,
  aNextStep,
  anAuthor,
  aPrView,
} from '@/test/fixtures.ts';
import { restoreFetch, stubFetch, type StubbedResponse } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const KASIA_AUTHOR = anAuthor({ login: 'kasia', name: 'Kasia', memberId: kasia.id });
const usual = { usuallyDecidedBy: KASIA_AUTHOR };
const first = aFinding({
  id: 11,
  severity: 'blocking',
  title: 'Undo loses the group',
  version: 2,
  ...usual,
});
const second = aFinding({
  id: 12,
  severity: 'blocking',
  title: 'Drag ignores the snap grid',
  ...usual,
});
const third = aFinding({ id: 13, severity: 'worth_fixing', title: 'Labels overflow', ...usual });
const nit = aFinding({ id: 14, severity: 'nit', title: 'Rename the helper' });
const FINDINGS = [first, second, third, nit];

const decisionBy = (member: TeamMember, over: Partial<DecisionView> = {}): DecisionView =>
  aDecision({ signedBy: { id: member.id, name: member.name }, author: KASIA_AUTHOR, ...over });

const decided = (findings: FindingView[], decision: DecisionView): DecideResponse => ({
  batchId: decision.batchId,
  implementerRunId: null,
  nextStep: aNextStep({
    state: 'waiting_for_fix',
    banner: { code: 'state_waiting_for_fix', params: { count: findings.length } },
  }),
  checklist: aChecklist(),
  findings: aFindingsResponse({
    findings: FINDINGS.map((f) =>
      findings.some((d) => d.id === f.id)
        ? {
            ...f,
            decision,
            version: f.version + 1,
            needsDecision: { ...f.needsDecision, needed: false },
          }
        : f,
    ),
  }),
});

function stubPr(routes: Record<string, StubbedResponse | unknown> = {}) {
  return stubFetch({
    '/api/prs/wb/12': aPrView({ author: KASIA_AUTHOR }),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings: FINDINGS }),
    '/api/team': { members: [kasia, tomek] },
    ...routes,
  });
}

const postsTo = (calls: { method: string; path: string }[], path: string) =>
  calls.filter((c) => c.method === 'POST' && c.path === path);

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, kasia.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

async function openFinding(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }));
  return screen.getByRole('article', { name: new RegExp(title) });
}

test('a bulk Implement sends one request with both ids and one signer', async () => {
  const { calls } = stubPr({
    'POST /api/prs/wb/12/decisions': decided([first, second], decisionBy(kasia)),
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  await user.click(await screen.findByRole('checkbox', { name: /Undo loses the group/ }));
  await user.click(screen.getByRole('checkbox', { name: /Drag ignores the snap grid/ }));
  const bar = screen.getByRole('region', { name: copy.decisions.bulk.label });
  expect(bar).toHaveTextContent('2 selected');

  await user.click(within(bar).getByRole('button', { name: /Implement…/ }));
  await waitFor(() => expect(within(bar).getByRole('combobox')).toHaveTextContent('Kasia'));
  await user.click(within(bar).getByRole('button', { name: 'Implement 2' }));

  await screen.findByText('2 findings to implement', { selector: '[data-title]' });
  const posts = postsTo(calls, '/api/prs/wb/12/decisions');
  expect(posts).toHaveLength(1);
  expect((posts[0] as { body?: unknown }).body).toEqual({
    findingIds: [11, 12],
    decision: 'implement',
    signedBy: kasia.id,
    expectedVersions: { 11: 2, 12: 0 },
  });
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: copy.decisions.bulk.label })).toBeNull(),
  );
});

test('Reject cannot be submitted without a reason', async () => {
  const { calls } = stubPr();
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const finding = await openFinding(user, 'Labels overflow');
  expect(finding).toHaveTextContent('Usually decided by: Kasia (author)');
  await user.click(within(finding).getByRole('button', { name: /Reject…/ }));
  await user.click(within(finding).getByRole('button', { name: 'Reject' }));

  expect(within(finding).getByRole('alert')).toHaveTextContent(copy.decisions.reason.required);
  expect(postsTo(calls, '/api/prs/wb/12/decisions')).toHaveLength(0);
});

test('a nit is optional, and a decided finding says who decided it', async () => {
  const rejected = {
    ...third,
    decision: decisionBy(tomek, { decision: 'reject', reason: 'By design' }),
  };
  stubPr({
    '/api/prs/wb/12/findings': aFindingsResponse({ findings: [first, rejected, nit] }),
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  expect(await openFinding(user, 'Rename the helper')).toHaveTextContent(copy.decisions.optional);
  const finding = await openFinding(user, 'Labels overflow');
  expect(within(finding).getByTestId('decision-badge')).toHaveTextContent('Rejected');
  const decidedBy = within(finding).getByTestId('decided-by');
  expect(decidedBy).toHaveTextContent('Rejected by Tomek (author: Kasia)');
  expect(decidedBy).toHaveTextContent('“By design”');
});

test('Enter in the reason confirms, and Undo calls the undo endpoint', async () => {
  const rejection = decisionBy(tomek, { decision: 'reject', reason: 'Not worth it' });
  const { calls } = stubPr({
    'POST /api/prs/wb/12/decisions': decided([third], rejection),
    'POST /api/decision-batches/7/undo': {
      nextStep: aNextStep(),
      checklist: aChecklist(),
      findings: aFindingsResponse({ findings: FINDINGS }),
    },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const finding = await openFinding(user, 'Labels overflow');
  await user.click(within(finding).getByRole('button', { name: /Reject…/ }));
  await user.type(
    within(finding).getByLabelText(copy.decisions.reason.reject),
    'Not worth it{Enter}',
  );

  await user.click(await screen.findByRole('button', { name: copy.decisions.toast.undo }));

  await waitFor(() => expect(postsTo(calls, '/api/decision-batches/7/undo')).toHaveLength(1));
  const body = (postsTo(calls, '/api/prs/wb/12/decisions')[0] as { body?: unknown }).body;
  expect(body).toMatchObject({ findingIds: [13], decision: 'reject', reason: 'Not worth it' });
  expect(await screen.findByText(copy.decisions.toast.undone)).toBeInTheDocument();
});

test('a conflict shows the other signer and refetches the findings', async () => {
  const { calls } = stubPr({
    'POST /api/prs/wb/12/decisions': {
      status: 409,
      body: {
        error: {
          code: 'decision_conflict',
          params: { conflicts: [{ findingId: 11, version: 3, decision: decisionBy(tomek) }] },
        },
      },
    },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const finding = await openFinding(user, 'Undo loses the group');
  await user.click(within(finding).getByRole('button', { name: /Implement…/ }));
  await waitFor(() => expect(within(finding).getByRole('combobox')).toHaveTextContent('Kasia'));
  await user.click(within(finding).getByRole('button', { name: 'Implement' }));

  expect(await within(finding).findByRole('alert')).toHaveTextContent(
    'Tomek decided this in the meantime.',
  );
  const findingsLoads = () => calls.filter((c) => c.path === '/api/prs/wb/12/findings').length;
  await waitFor(() => expect(findingsLoads()).toBeGreaterThan(1));
});

test('a decision that arrives live while the form is open still ends in a conflict', async () => {
  const conflict = { findingId: 11, version: 3, decision: decisionBy(tomek) };
  const { calls } = stubPr({
    'POST /api/prs/wb/12/decisions': {
      status: 409,
      body: { error: { code: 'decision_conflict', params: { conflicts: [conflict] } } },
    },
  });
  const user = userEvent.setup();
  const { queryClient } = renderApp('/pr/wb/12');

  const finding = await openFinding(user, 'Undo loses the group');
  await user.click(within(finding).getByRole('button', { name: /Implement…/ }));
  await waitFor(() => expect(within(finding).getByRole('combobox')).toHaveTextContent('Kasia'));
  // A live update brings Tomek's decision before this person confirms.
  queryClient.setQueryData(
    prKeys.findings('wb', '12'),
    aFindingsResponse({
      findings: FINDINGS.map((f) =>
        f.id === first.id ? { ...f, version: 3, decision: conflict.decision } : f,
      ),
    }),
  );
  await waitFor(() =>
    expect(within(finding).getByTestId('decision-badge')).toHaveTextContent('Implement'),
  );
  await user.click(within(finding).getByRole('button', { name: 'Implement' }));

  expect(await within(finding).findByRole('alert')).toHaveTextContent(
    'Tomek decided this in the meantime.',
  );
  // Having seen the conflict, saving again overrides Tomek's decision on purpose.
  await user.click(within(finding).getByRole('button', { name: 'Implement' }));
  await waitFor(() => expect(postsTo(calls, '/api/prs/wb/12/decisions')).toHaveLength(2));
  const versions = postsTo(calls, '/api/prs/wb/12/decisions').map(
    (c) => (c as { body?: { expectedVersions?: unknown } }).body?.expectedVersions,
  );
  expect(versions).toEqual([{ 11: 2 }, { 11: 3 }]);
});
