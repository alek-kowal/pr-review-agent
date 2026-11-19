// S-11-T3: the sensitive files banner, its two actions and the side panel, for pending, approved
// and sent back files.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type {
  NextStepView,
  PrView,
  SensitiveResult,
  SensitiveView,
  TeamMember,
} from '@/lib/api-types.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import { errorText } from '@/lib/reasons.ts';
import { aChecklist, aFindingsResponse, aNextStep, anAuthor, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
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
const author = anAuthor({ login: 'kasia', memberId: kasia.id, name: kasia.name });

type Status = NonNullable<SensitiveView['status']>;

const MIGRATION = 'db/migrations/0001_edge_labels.sql';
const DEPLOY = 'infra/deploy.yml';

const sensitive = (status: Status, over: Partial<SensitiveView> = {}): SensitiveView => ({
  version: 3,
  status,
  files: [
    {
      path: MIGRATION,
      pattern: 'db/migrations/**',
      reason: 'Migrations cannot be undone.',
      status,
    },
    { path: DEPLOY, pattern: 'infra/**', reason: 'Deploys to production.', status },
  ],
  sentBack: null,
  ...over,
});

const approveAction: NonNullable<NextStepView['mainAction']> = {
  action: 'approve_sensitive',
  signed: false,
  optional: false,
  disabled: null,
  stage: null,
};

const byTomek = { kind: 'member', memberId: tomek.id };

const checklist = (code: string, ok: boolean, params: Record<string, unknown> = {}) =>
  aChecklist({
    ok,
    items: [
      { item: 'sensitive_files_approved', ok, reason: { code, params: { count: 2, ...params } } },
    ],
  });

const pending: SensitiveResult = {
  sensitive: sensitive('pending'),
  nextStep: aNextStep({
    state: 'sensitive_files',
    banner: { code: 'state_sensitive_files', params: { count: 2 } },
    who: { code: 'who_usually_teammate', params: { author: 'kasia' } },
    mainAction: approveAction,
  }),
  checklist: checklist('checklist_sensitive_pending', false),
};

const approved: SensitiveResult = {
  sensitive: sensitive('approved'),
  nextStep: aNextStep({
    state: 'ready_to_merge',
    lane: 'ready_to_merge',
    tone: 'ready',
    banner: { code: 'state_ready_to_merge', params: { sha: 'abc1234def' } },
    who: { code: 'who_nobody', params: {} },
    mainAction: null,
  }),
  checklist: checklist('checklist_sensitive_approved', true),
};

const sentBack: SensitiveResult = {
  sensitive: sensitive('sent_back', {
    version: 4,
    sentBack: {
      by: { id: tomek.id, name: tomek.name },
      comment: 'Split the migration from the rename.',
      at: '2026-11-19T12:00:00.000Z',
    },
  }),
  nextStep: aNextStep({
    state: 'sensitive_files',
    banner: { code: 'state_sensitive_sent_back', params: { count: 2, by: byTomek } },
    who: { code: 'who_usually_author', params: { author: 'kasia' } },
    mainAction: approveAction,
  }),
  checklist: checklist('checklist_sensitive_sent_back', false, { by: byTomek }),
};

const viewOf = (result: SensitiveResult): PrView => aPrView({ author, ...result });

/** Serves `view` as the PR page; the returned routes let a test change what a refetch sees. */
function serve(view: PrView, routes: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/api/prs/wb/12': view,
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/team': { members: [kasia, tomek] },
    ...routes,
  };
  return { table, ...stubFetch(table) };
}

const banner = () => screen.findByTestId('next-step');
const panel = () => screen.findByTestId('sensitive-files');

afterEach(restoreFetch);
beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));

describe('pending sensitive files', () => {
  test('the banner asks to approve them and the panel lists each with its pattern', async () => {
    serve(viewOf(pending));
    renderApp('/pr/wb/12');

    const step = await banner();
    expect(step).toHaveTextContent('Approve changes to 2 sensitive files');
    expect(within(step).getByTestId('sensitive-line')).toHaveTextContent(
      copy.sensitive.pendingLine,
    );
    expect(within(step).getByRole('button', { name: /Approve changes/ })).toBeEnabled();
    expect(within(step).getByRole('button', { name: /Send back…/ })).toBeEnabled();

    const files = await panel();
    expect(within(files).getByTestId('sensitive-status')).toHaveTextContent('need approval');
    expect(files).toHaveTextContent(MIGRATION);
    expect(files).toHaveTextContent('Matches db/migrations/**. Migrations cannot be undone.');
    expect(files).toHaveTextContent(DEPLOY);
    expect(files).toHaveTextContent('Matches infra/**. Deploys to production.');
  });

  test('Approve changes posts the version seen, unsigned, and the page shows them approved', async () => {
    const { table, calls } = serve(viewOf(pending), {
      'POST /api/prs/wb/12/sensitive/approve': approved,
    });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const step = await banner();
    table['/api/prs/wb/12'] = viewOf(approved);
    await user.click(within(step).getByRole('button', { name: /Approve changes/ }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/prs/wb/12/sensitive/approve',
        body: { version: 3 },
        headers: expect.objectContaining({ 'X-PRA-Request': '1' }),
      }),
    );
    expect(await screen.findByText(copy.sensitive.approved)).toBeVisible();
    await waitFor(async () =>
      expect(within(await panel()).getByTestId('sensitive-status')).toHaveTextContent(
        'approved by hand',
      ),
    );
    expect(await banner()).toHaveTextContent('Ready to merge at abc1234');
  });

  test('Send back… needs a comment and a signer, then posts both with the version', async () => {
    const { table, calls } = serve(viewOf(pending), {
      'POST /api/prs/wb/12/sensitive/send-back': sentBack,
    });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const step = await banner();
    await user.click(within(step).getByRole('button', { name: /Send back…/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(copy.sensitive.dialog.description('Kasia'));
    expect(dialog).toHaveTextContent(MIGRATION);
    expect(dialog).toHaveTextContent(DEPLOY);

    const confirm = within(dialog).getByRole('button', { name: 'Send back to Kasia' });
    await user.click(confirm);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      copy.sensitive.dialog.commentRequired('Kasia'),
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    table['/api/prs/wb/12'] = viewOf(sentBack);
    await user.type(
      within(dialog).getByLabelText(copy.sensitive.dialog.commentLabel),
      'Split the migration from the rename.',
    );
    await user.click(confirm);

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/prs/wb/12/sensitive/send-back',
        body: { version: 3, comment: 'Split the migration from the rename.', signedBy: tomek.id },
      }),
    );
    expect(await screen.findByText(copy.sensitive.dialog.sent('Kasia'))).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await banner()).toHaveTextContent('Sent back by Tomek: Kasia changes 2 sensitive files');
  });

  test('a stale version shows why the action failed', async () => {
    serve(viewOf(pending), {
      'POST /api/prs/wb/12/sensitive/approve': {
        status: 409,
        body: { error: { code: 'sensitive_stale', params: { version: 4 } } },
      },
    });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    await user.click(within(await banner()).getByRole('button', { name: /Approve changes/ }));
    expect(await screen.findByText(errorText('sensitive_stale'))).toBeVisible();
  });
});

test('approved files: no banner action, the panel and the checklist say approved by hand', async () => {
  serve(viewOf(approved));
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const step = await banner();
  expect(within(step).queryByRole('button', { name: /Approve changes/ })).toBeNull();
  expect(within(step).queryByTestId('sensitive-line')).toBeNull();
  expect(within(await panel()).getByTestId('sensitive-status')).toHaveTextContent(
    'approved by hand',
  );
  // A green checklist is one line; opening it shows the row's reason.
  await user.click(within(await screen.findByTestId('checklist')).getByRole('button'));
  expect(await screen.findByText('2 sensitive files approved by hand.')).toBeVisible();
});

test('sent back files: the banner names who sent them back and quotes the comment', async () => {
  serve(viewOf(sentBack));
  renderApp('/pr/wb/12');

  const step = await banner();
  expect(step).toHaveTextContent('Sent back by Tomek: Kasia changes 2 sensitive files');
  expect(within(step).getByTestId('sensitive-line')).toHaveTextContent(
    '"Split the migration from the rename."',
  );
  expect(within(step).getByRole('button', { name: /Approve changes/ })).toBeEnabled();

  const files = await panel();
  expect(within(files).getByTestId('sensitive-status')).toHaveTextContent('sent back');
  expect(files).toHaveTextContent('"Split the migration from the rename."');
});
