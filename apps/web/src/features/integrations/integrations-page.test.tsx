// S-20-T7: Settings → Integrations.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { IntegrationsResponse, TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.integrations;
const PATH = '/api/settings/integrations';
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const status = (over: Partial<IntegrationsResponse> = {}): IntegrationsResponse => ({
  github: {
    configured: true,
    missing: [],
    installations: [{ id: 7, account: 'acme', repositoryCount: 2 }],
    repositories: [
      { fullName: 'acme/one', installationId: 7, account: 'acme', private: false },
      { fullName: 'acme/two', installationId: 7, account: 'acme', private: true },
    ],
    listError: null,
    deliveries: {
      last: {
        deliveryId: 'd-1',
        event: 'pull_request',
        action: 'ready_for_review',
        repositoryFullName: 'acme/one',
        receivedAt: '2026-11-19T08:00:00.000Z',
        processedAt: '2026-11-19T08:00:01.000Z',
      },
      last24h: 12,
      signatureFailures24h: 1,
      lastSignatureFailureAt: '2026-11-19T07:00:00.000Z',
    },
    lastReconcilePoll: null,
  },
  clickup: { configured: true, missing: [], lastCall: null },
  settings: { afterRoundGithubComment: true },
  ...over,
});

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

const card = (name: string) => screen.findByRole('region', { name });
const callsTo = (calls: FetchCall[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

describe('Settings → Integrations', () => {
  test('shows GitHub installations, repositories and delivery health', async () => {
    stubFetch({ [PATH]: status() });
    renderApp('/settings/integrations');

    const github = await card(t.github.title);
    expect(github).toHaveTextContent(t.connected);
    expect(github).toHaveTextContent(t.github.installation('acme', 2));
    expect(github).toHaveTextContent('acme/two');
    expect(github).toHaveTextContent(t.github.deliveries24h(12));
    expect(github).toHaveTextContent(t.github.failures24h(1));
    expect(github).toHaveTextContent('pull_request.ready_for_review');
  });

  test('the not-configured states show their text', async () => {
    stubFetch({
      [PATH]: status({
        github: {
          ...status().github,
          configured: false,
          missing: ['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET'],
          installations: [],
          repositories: [],
          deliveries: {
            last: null,
            last24h: 0,
            signatureFailures24h: 0,
            lastSignatureFailureAt: null,
          },
        },
        clickup: { configured: false, missing: ['CLICKUP_API_KEY'], lastCall: null },
      }),
    });
    renderApp('/settings/integrations');

    const github = await card(t.github.title);
    expect(github).toHaveTextContent(t.notConfigured);
    expect(github).toHaveTextContent(t.missing(['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET']));
    expect(github).toHaveTextContent(t.github.noDelivery);
    expect(github).not.toHaveTextContent(t.connected);
    const clickup = await card(t.clickup.title);
    expect(clickup).toHaveTextContent(t.notConfigured);
    expect(clickup).toHaveTextContent(t.missing(['CLICKUP_API_KEY']));
    expect(clickup).toHaveTextContent(t.clickup.noCall);
  });

  test('Test connection shows the result, ok or the error', async () => {
    const stub = stubFetch({
      [PATH]: status(),
      [`POST ${PATH}/clickup/test`]: { ok: true, user: { id: '1', username: 'review-bot' } },
    });
    renderApp('/settings/integrations');
    const user = userEvent.setup();
    const clickup = await card(t.clickup.title);

    await user.click(within(clickup).getByRole('button', { name: t.clickup.test }));
    expect(await within(clickup).findByRole('status')).toHaveTextContent(
      t.clickup.testOk('review-bot'),
    );

    stubFetch({
      [PATH]: status(),
      [`POST ${PATH}/clickup/test`]: {
        ok: false,
        error: { code: 'clickup_auth_failed', params: {} },
      },
    });
    await user.click(within(clickup).getByRole('button', { name: t.clickup.test }));
    await waitFor(() =>
      expect(within(clickup).getByRole('status')).toHaveTextContent(
        t.clickup.testFailed(copy.errors.clickup_auth_failed!),
      ),
    );
    expect(callsTo(stub.calls, 'POST', `${PATH}/clickup/test`)).toHaveLength(1);
  });

  test('the switch counts as one unsaved change and saves signed', async () => {
    const { calls } = stubFetch({
      [PATH]: status(),
      '/api/team': { members: [tomek] },
      [`PUT ${PATH}`]: { settings: { afterRoundGithubComment: false } },
    });
    renderApp('/settings/integrations');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: t.comment.label }));
    expect(screen.getByRole('region', { name: copy.settings.saveBar.label })).toHaveTextContent(
      copy.settings.unsaved(1),
    );
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog', { name: t.comment.saveTitle });
    expect(
      within(dialog).getByRole('row', { name: new RegExp(t.comment.field) }),
    ).toHaveTextContent(`${t.comment.field}${t.on}${t.off}`);
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    await waitFor(() => expect(callsTo(calls, 'PUT', PATH)).toHaveLength(1));
    expect(callsTo(calls, 'PUT', PATH)[0]?.body).toEqual({
      afterRoundGithubComment: false,
      before: { afterRoundGithubComment: true },
      signedBy: tomek.id,
    });
  });
});
