// S-09-T4: Cancel is the banner's main action while a round is queued or running, and the last
// button of each Activity In progress row. Both send an unsigned cancel of that run.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { NextStepBanner } from '@/features/pr/NextStepBanner.tsx';
import type { InProgressRun } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { aNextStep, aPrView, aRound } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { renderInRouter } from '@/test/renderInRouter.tsx';

afterEach(restoreFetch);

const CANCELLING = { status: 202, body: { status: 'cancelling' } };
const posted = (calls: FetchCall[]) => calls.find((call) => call.method === 'POST');

describe('Cancel', () => {
  test('the banner cancels the running round, unsigned', async () => {
    const { calls } = stubFetch({ 'POST /api/runs/51/cancel': CANCELLING });
    const user = userEvent.setup();
    const view = aPrView({
      round: aRound({ id: 51, status: 'running' }),
      nextStep: aNextStep({
        state: 'round_running',
        banner: { code: 'state_round_running_by_hand', params: { roundNumber: 1, max: 3 } },
        who: { code: 'who_no_one_needs_to_act', params: {} },
        mainAction: {
          action: 'cancel',
          signed: false,
          optional: false,
          disabled: null,
          stage: null,
        },
      }),
    });
    renderInRouter(<NextStepBanner repo="wb" number="12" view={view} />);
    const banner = await screen.findByRole('region', { name: copy.nextStep.label });

    await user.click(within(banner).getByRole('button', { name: 'Cancel' }));

    await expect
      .poll(() => posted(calls))
      .toMatchObject({ path: '/api/runs/51/cancel', headers: { 'X-PRA-Request': '1' } });
    expect(posted(calls)?.body).toBeUndefined();
    // One request: the button stays off until the views refresh.
    expect(within(banner).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  test('an Activity In progress row cancels its run', async () => {
    const run: InProgressRun = {
      id: 77,
      kind: 'round',
      status: 'queued',
      roundNumber: 2,
      level: { number: 2, key: 'context' },
      currentStage: null,
      costUsd: 0,
      createdAt: '2026-11-19T10:00:00.000Z',
      startedAt: null,
      pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
    };
    const { calls } = stubFetch({
      '/api/activity/in-progress': { runs: [run] },
      'POST /api/runs/77/cancel': CANCELLING,
    });
    const user = userEvent.setup();
    renderApp('/activity');

    await user.click(await screen.findByRole('button', { name: 'Cancel Round 2 of 3' }));

    await expect.poll(() => posted(calls)).toMatchObject({ path: '/api/runs/77/cancel' });
  });
});
