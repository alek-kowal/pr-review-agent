// CONNECT: "Refresh from GitHub" on the board, without the GitHub App.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { GitHubPoller, IntegrationsResponse } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { anEmptyBoard, aStatus } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const t = copy.board.refresh;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const polling = (poller: Partial<GitHubPoller>): IntegrationsResponse => ({
  github: {
    configured: false,
    missing: ['GITHUB_APP_ID'],
    installations: [],
    repositories: [],
    listError: null,
    deliveries: { last: null, last24h: 0, signatureFailures24h: 0, lastSignatureFailureAt: null },
    lastReconcilePoll: null,
    mode: 'token',
    poller: {
      schedule: { intervalMinutes: 5, from: '08:00', to: '18:00', days: [1], timeZone: 'UTC' },
      windowOpen: true,
      lastStartedAt: minutesAgo(5),
      lastFinishedAt: minutesAgo(5),
      running: false,
      nextPollAt: minutesAgo(-5),
      lastError: null,
      backoffUntil: null,
      rateLimit: null,
      repositories: [],
      ...poller,
    },
  },
  clickup: { configured: false, missing: [], lastCall: null },
  settings: { afterRoundGithubComment: false },
});

test('token mode: Refresh from GitHub polls now, waits for the poll, then says when it ended', async () => {
  let phase: 'before' | 'running' | 'done' = 'before';
  const failed = { code: 'github_poll_failed', params: { items: ['acme/one#7'] } };
  const { calls } = stubFetch({
    '/api/status': aStatus({ githubMode: 'token' }),
    '/api/board': anEmptyBoard(),
    get '/api/settings/integrations'() {
      if (phase === 'before') return polling({ lastError: failed });
      if (phase === 'running') return polling({ lastError: failed, running: true });
      return polling({ lastFinishedAt: new Date().toISOString() });
    },
    'POST /api/settings/integrations/poll-now': { status: 202, body: { queued: true } },
  });
  renderApp('/prs');
  const user = userEvent.setup();

  const refresh = await screen.findByRole('group', { name: t.label });
  expect(refresh).toHaveTextContent(t.updated(5 * 60_000));
  expect(refresh).toHaveTextContent(t.lastError('Could not read acme/one#7.'));
  phase = 'running';
  await user.click(within(refresh).getByRole('button', { name: t.button }));

  // Off while the poll runs; it asked once.
  expect(await within(refresh).findByRole('button', { name: t.refreshing })).toBeDisabled();
  expect(pollNowCalls(calls)).toHaveLength(1);
  phase = 'done';
  await waitFor(() => expect(refresh).toHaveTextContent(t.updated(0)), { timeout: 5_000 });
  expect(within(refresh).getByRole('button', { name: t.button })).toBeEnabled();
  expect(refresh).not.toHaveTextContent(/Last poll/);
});

const pollNowCalls = (calls: FetchCall[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/settings/integrations/poll-now');
