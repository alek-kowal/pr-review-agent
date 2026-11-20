// S-20-T7: Settings → Integrations.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type {
  GitHubMode,
  GitHubPollSchedule,
  GitHubPoller,
  IntegrationsResponse,
  TeamMember,
} from '@/lib/api-types.ts';
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
    mode: 'app',
    poller: null,
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

// P-28: polling GitHub until the GitHub App exists.
describe('Settings → Integrations without the GitHub App', () => {
  const p = t.poller;
  const schedule: GitHubPollSchedule = {
    intervalMinutes: 5,
    from: '08:00',
    to: '18:00',
    days: [1, 2, 3, 4, 5],
    timeZone: 'Europe/Warsaw',
  };
  const poller = (over: Partial<GitHubPoller> = {}): GitHubPoller => ({
    schedule,
    windowOpen: true,
    lastStartedAt: '2026-11-19T08:00:00.000Z',
    lastFinishedAt: '2026-11-19T08:00:02.000Z',
    running: false,
    nextPollAt: '2026-11-19T08:05:00.000Z',
    lastError: null,
    backoffUntil: null,
    rateLimit: { limit: 60, remaining: 42, resetAt: '2026-11-19T09:00:00.000Z' },
    repositories: [
      {
        fullName: 'acme/one',
        baselineAt: '2026-11-19T07:00:00.000Z',
        lastPolledAt: null,
        openCount: 3,
      },
      { fullName: 'acme/two', baselineAt: null, lastPolledAt: null, openCount: 0 },
    ],
    ...over,
  });
  const polling = (mode: GitHubMode, over: Partial<GitHubPoller> = {}) =>
    status({
      github: {
        ...status().github,
        configured: false,
        missing: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET'],
        installations: [],
        repositories: [],
        mode,
        poller: poller(over),
      },
    });

  test('the poller card shows the mode, the last poll, the rate limit and the baselines', async () => {
    stubFetch({ [PATH]: polling('anonymous') });
    renderApp('/settings/integrations');

    const card = await screen.findByRole('region', { name: p.title });
    expect(within(card).getByRole('note')).toHaveTextContent(p.readOnly);
    expect(card).toHaveTextContent(p.modes.anonymous!);
    expect(card).toHaveTextContent(p.anonymousWarning);
    expect(card).toHaveTextContent(/42 of 60 requests left/);
    expect(card).toHaveTextContent(`acme/one· ${p.repository(3)}`);
    expect(card).toHaveTextContent(p.notBaselined);
    expect(card).toHaveTextContent(p.noError);
  });

  test('a token hides the 60-an-hour warning; a rate limit shows as the last error', async () => {
    stubFetch({
      [PATH]: polling('token', {
        windowOpen: false,
        lastError: {
          code: 'github_rate_limited',
          params: { resetAt: '2026-11-19T09:00:00.000Z' },
        },
      }),
    });
    renderApp('/settings/integrations');

    const card = await screen.findByRole('region', { name: p.title });
    expect(card).toHaveTextContent(p.modes.token!);
    expect(card).not.toHaveTextContent(p.anonymousWarning);
    expect(card).toHaveTextContent(p.windowClosed);
    expect(card).toHaveTextContent(/rate limit is used up until/);
  });

  test('Poll now queues one poll and says so', async () => {
    const { calls } = stubFetch({
      [PATH]: polling('token'),
      [`POST ${PATH}/poll-now`]: { queued: true },
    });
    renderApp('/settings/integrations');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: p.pollNow }));

    expect(await screen.findByText(p.pollQueued)).toBeInTheDocument();
    expect(callsTo(calls, 'POST', `${PATH}/poll-now`)).toHaveLength(1);
    expect(callsTo(calls, 'POST', `${PATH}/poll-now`)[0]?.headers).toMatchObject({
      'X-PRA-Request': '1',
    });
  });

  test('the schedule saves signed with its before', async () => {
    const { calls } = stubFetch({
      [PATH]: polling('token'),
      '/api/team': { members: [tomek] },
      [`PUT ${PATH}/poll`]: { schedule: { ...schedule, intervalMinutes: 15 } },
    });
    renderApp('/settings/integrations');
    const user = userEvent.setup();

    const interval = await screen.findByLabelText(p.schedule.interval);
    await user.clear(interval);
    await user.type(interval, '15');
    await user.click(within(await card(p.title)).getByRole('checkbox', { name: 'Sat' }));
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog', { name: p.schedule.saveTitle });
    expect(
      within(dialog).getByRole('row', { name: new RegExp(p.schedule.fieldInterval) }),
    ).toHaveTextContent(`${p.schedule.minutes(5)}${p.schedule.minutes(15)}`);
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    await waitFor(() => expect(callsTo(calls, 'PUT', `${PATH}/poll`)).toHaveLength(1));
    expect(callsTo(calls, 'PUT', `${PATH}/poll`)[0]?.body).toEqual({
      ...schedule,
      intervalMinutes: 15,
      days: [1, 2, 3, 4, 5, 6],
      before: schedule,
      signedBy: tomek.id,
    });
  });
});
