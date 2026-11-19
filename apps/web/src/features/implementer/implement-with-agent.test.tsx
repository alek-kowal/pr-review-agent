// S-13-T5: Implement with agent in the Implement form, the bulk bar and the Next step banner.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { DecideResponse, ImplementerView, TeamMember } from '@/lib/api-types.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import { aChecklist, aFinding, aFindingsResponse, aNextStep, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch, type StubbedResponse } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};
const first = aFinding({ id: 11, severity: 'blocking', title: 'Undo loses the group' });
const second = aFinding({ id: 12, severity: 'blocking', title: 'Drag ignores the snap grid' });
const FINDINGS = [first, second];

const BELOW_LEVEL = { code: 'implement_below_level', params: { level: 3, need: 4 } };
const FORK = { code: 'fork_read_only', params: {} };

const WAITING_FOR_FIX = aNextStep({
  state: 'waiting_for_fix',
  banner: { code: 'state_waiting_for_fix', params: { count: 2 } },
  mainAction: {
    action: 'implement_with_agent',
    signed: true,
    optional: false,
    disabled: null,
    stage: null,
  },
});

const decided: DecideResponse = {
  batchId: 3,
  implementerRunId: 41,
  nextStep: aNextStep({
    state: 'fixing',
    tone: 'working',
    banner: { code: 'state_fixing', params: { count: 2, startedBy: { kind: 'member' } } },
    mainAction: { action: 'cancel', signed: false, optional: false, disabled: null, stage: null },
  }),
  checklist: aChecklist(),
  findings: aFindingsResponse({ findings: FINDINGS }),
};

function stubPr(
  view: {
    implementer?: Partial<ImplementerView>;
    nextStep?: typeof WAITING_FOR_FIX;
    isFork?: boolean;
  },
  routes: Record<string, StubbedResponse | unknown> = {},
) {
  return stubFetch({
    '/api/prs/wb/12': aPrView(view),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings: FINDINGS }),
    '/api/team': { members: [kasia] },
    ...routes,
  });
}

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, kasia.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

async function openBulkImplement(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: /Undo loses the group/ }));
  await user.click(screen.getByRole('checkbox', { name: /Drag ignores the snap grid/ }));
  const bar = screen.getByRole('region', { name: copy.decisions.bulk.label });
  await user.click(within(bar).getByRole('button', { name: /Implement…/ }));
  return bar;
}

test('below level 4 the checkbox is disabled with the reason text', async () => {
  stubPr({ implementer: { block: BELOW_LEVEL } });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const bar = await openBulkImplement(user);
  const box = await within(bar).findByRole('checkbox', { name: copy.implementer.withAgent });
  expect(box).toBeDisabled();
  expect(box).toHaveAccessibleDescription(
    'Implement with agent needs level 4. This PR is at level 3.',
  );
});

test('on a fork the checkbox is disabled with the reason text', async () => {
  stubPr({ isFork: true, implementer: { block: FORK } });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const bar = await openBulkImplement(user);
  const box = await within(bar).findByRole('checkbox', { name: copy.implementer.withAgent });
  expect(box).toBeDisabled();
  expect(within(bar).getByText(copy.implementer.blockText(FORK))).toBeVisible();
});

test('one submit sends the decisions and withAgent under one signer', async () => {
  const { calls } = stubPr({}, { 'POST /api/prs/wb/12/decisions': decided });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const bar = await openBulkImplement(user);
  await user.click(await within(bar).findByRole('checkbox', { name: copy.implementer.withAgent }));
  await waitFor(() => expect(within(bar).getByRole('combobox')).toHaveTextContent('Kasia'));
  await user.click(within(bar).getByRole('button', { name: 'Implement 2' }));

  await waitFor(() =>
    expect(calls.filter((c) => c.path === '/api/prs/wb/12/decisions')).toHaveLength(1),
  );
  expect(calls.find((c) => c.path === '/api/prs/wb/12/decisions')?.body).toEqual({
    findingIds: [11, 12],
    decision: 'implement',
    signedBy: kasia.id,
    expectedVersions: { 11: 0, 12: 0 },
    withAgent: true,
  });
  expect(calls.some((c) => c.path === '/api/prs/wb/12/implement')).toBe(false);
});

test('"Raise this PR to level 4" sends an unsigned level change', async () => {
  const blocked = {
    ...WAITING_FOR_FIX,
    mainAction: { ...WAITING_FOR_FIX.mainAction!, disabled: BELOW_LEVEL },
  };
  const { calls } = stubPr(
    { nextStep: blocked, implementer: { block: BELOW_LEVEL } },
    { 'PUT /api/prs/wb/12/level': { body: {} } },
  );
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const banner = await screen.findByTestId('next-step');
  const implement = await within(banner).findByRole('button', { name: /Implement with agent…/ });
  expect(implement).toBeDisabled();
  expect(implement).toHaveAccessibleDescription(copy.implementer.blockText(BELOW_LEVEL));

  await user.click(within(banner).getByRole('button', { name: copy.implementer.raiseLevel(4) }));
  await waitFor(() =>
    expect(
      calls.find((c) => c.method === 'PUT' && c.path === '/api/prs/wb/12/level')?.body,
    ).toEqual({ level: 4 }),
  );
});

test('the banner Dialog lists the findings and starts the implementer, signed', async () => {
  const { calls } = stubPr(
    {
      nextStep: WAITING_FOR_FIX,
      implementer: { gate: { allowed: true, reason: null, findingIds: [11, 12] } },
    },
    { 'POST /api/prs/wb/12/implement': { status: 202, body: { runId: 41, findingIds: [11, 12] } } },
  );
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const banner = await screen.findByTestId('next-step');
  await user.click(await within(banner).findByRole('button', { name: /Implement with agent…/ }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText(/Undo loses the group/)).toBeVisible();
  expect(within(dialog).getByText(/Drag ignores the snap grid/)).toBeVisible();
  await waitFor(() => expect(within(dialog).getByRole('combobox')).toHaveTextContent('Kasia'));
  await user.click(within(dialog).getByRole('button', { name: copy.implementer.dialog.submit }));

  await waitFor(() =>
    expect(calls.find((c) => c.path === '/api/prs/wb/12/implement')?.body).toEqual({
      signedBy: kasia.id,
    }),
  );
});

test('Fixing shows who started it and Cancel cancels the implementer run', async () => {
  const { calls } = stubPr(
    {
      nextStep: aNextStep({
        state: 'fixing',
        tone: 'working',
        banner: {
          code: 'state_fixing',
          params: { count: 2, startedBy: { kind: 'member', memberId: kasia.id } },
        },
        mainAction: {
          action: 'cancel',
          signed: false,
          optional: false,
          disabled: null,
          stage: null,
        },
      }),
      implementer: {
        activeRun: { id: 41, status: 'running', findingIds: [11, 12], revisesPatchId: null },
      },
    },
    { 'POST /api/runs/41/cancel': { status: 202, body: { status: 'cancelling' } } },
  );
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const banner = await screen.findByTestId('next-step');
  expect(
    await within(banner).findByText(/Implementer is fixing 2 findings · started by/),
  ).toBeVisible();
  await user.click(within(banner).getByRole('button', { name: copy.runs.cancel.action }));
  await waitFor(() =>
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/runs/41/cancel')).toBe(true),
  );
});
