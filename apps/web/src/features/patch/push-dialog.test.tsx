// S-14-T4: the Patch ready banner's "Push to <branch>…" and its dialog: the typed number and a
// signer unlock Push, a 409 head_moved shows the reason in plain words, success closes and toasts.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { NextStepView, PatchDetail, PrView, TeamMember } from '@/lib/api-types.ts';
import { aFindingsResponse, aNextStep, aPatchSummary, aPrView, aStatus } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};

const pushAction: NonNullable<NextStepView['mainAction']> = {
  action: 'push',
  signed: true,
  optional: false,
  disabled: null,
  stage: null,
};

const patch = aPatchSummary({ id: 5, baseSha: 'abc1234def' });
const ready: PrView = aPrView({
  implementer: { patch },
  nextStep: aNextStep({
    state: 'patch_ready',
    lane: 'action_needed',
    tone: 'ready',
    banner: {
      code: 'state_patch_ready',
      params: { fixed: 2, total: 2, reproductionsPass: true },
    },
    mainAction: pushAction,
  }),
});
const detail: PatchDetail = {
  patch,
  files: [
    {
      path: 'src/a.ts',
      status: 'changed',
      blobKey: 'a',
      base: 'a\n',
      content: 'b\n',
      diff: '',
    },
    {
      path: 'src/b.ts',
      status: 'reverted',
      blobKey: null,
      base: 'a\n',
      content: 'a\n',
      diff: '',
    },
  ],
};

const PUSH = 'POST /api/patches/5/push';

function serve(routes: Record<string, unknown> = {}) {
  return stubFetch({
    '/api/prs/wb/12': ready,
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/patches/5': detail,
    '/api/team': { members: [kasia] },
    ...routes,
  });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const banner = await screen.findByTestId('next-step');
  await user.click(within(banner).getByRole('button', { name: 'Push to feature/grouping…' }));
  return screen.findByRole('alertdialog', { name: 'Push to feature/grouping' });
}

const typeNumber = (dialog: HTMLElement) =>
  within(dialog).getByRole('textbox', { name: 'Type 12 to confirm' });
const pushButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Push to feature/grouping' });

afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

describe('Push dialog', () => {
  // P-28: polling without the GitHub App never writes to GitHub.
  test('without the GitHub App the push button is off and says why', async () => {
    serve({ '/api/status': aStatus({ githubMode: 'anonymous' }) });
    renderApp('/pr/wb/12');

    const banner = await screen.findByTestId('next-step');
    const button = within(banner).getByRole('button', { name: 'Push to feature/grouping…' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription(
      `${copy.status.githubReadOnly.label}. ${copy.status.githubReadOnly.push}`,
    );
  });

  test('shows the patch summary: fixed of total, reproductions and the files pushed', async () => {
    serve();
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const dialog = await openDialog(user);
    const summary = within(dialog).getByTestId('push-summary');
    expect(summary).toHaveTextContent('2 of 2 fixed · reproductions pass');
    expect(await within(summary).findByText(/1 file$/)).toBeVisible();
    expect(dialog).toHaveTextContent(copy.push.description('abc1234def'));
  });

  test('Push stays disabled until the typed number matches and a signer is picked', async () => {
    const { calls } = serve({ [PUSH]: { status: 202, body: { queued: true } } });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const dialog = await openDialog(user);
    expect(pushButton(dialog)).toBeDisabled();
    await user.type(typeNumber(dialog), '1');
    expect(pushButton(dialog)).toBeDisabled();
    expect(pushButton(dialog)).toHaveAttribute('title', copy.push.typeToConfirm(12));
    await user.type(typeNumber(dialog), '2');
    expect(pushButton(dialog)).toHaveAttribute('title', copy.push.pickSigner);

    await user.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
    await user.click(await screen.findByRole('option', { name: /Kasia/ }));
    expect(pushButton(dialog)).toBeEnabled();

    await user.type(typeNumber(dialog), '3');
    expect(pushButton(dialog)).toBeDisabled();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  describe('with a remembered signer', () => {
    beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, kasia.id));

    test('a 409 head_moved shows the reason and keeps the dialog open', async () => {
      serve({
        [PUSH]: {
          status: 409,
          body: { error: { code: 'head_moved', params: { headSha: 'def4567890' } } },
        },
      });
      const user = userEvent.setup();
      renderApp('/pr/wb/12');

      const dialog = await openDialog(user);
      await user.type(typeNumber(dialog), '12');
      await user.click(pushButton(dialog));

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(
        'The head moved to def4567 after the patch was made. Start review to check the new commits.',
      );
      expect(dialog).toBeVisible();
    });

    test('success sends the typed number and signer, closes the dialog and toasts', async () => {
      const { calls } = serve({ [PUSH]: { status: 202, body: { queued: true } } });
      const user = userEvent.setup();
      renderApp('/pr/wb/12');

      const dialog = await openDialog(user);
      await user.type(typeNumber(dialog), '12');
      await user.click(pushButton(dialog));

      await waitFor(() =>
        expect(calls.find((c) => c.method === 'POST')).toMatchObject({
          path: '/api/patches/5/push',
          body: { typedNumber: 12, signedBy: kasia.id },
          headers: expect.objectContaining({ 'X-PRA-Request': '1' }),
        }),
      );
      expect(await screen.findByText(copy.push.queued('feature/grouping'))).toBeVisible();
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });
  });
});
