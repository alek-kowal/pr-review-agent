// S-07-T5: Start review in the header and the banner, and the head-moved banners.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { NextStepView } from '@/lib/api-types.ts';
import { NextStepBanner } from '@/features/pr/NextStepBanner.tsx';
import { PrHeader } from '@/features/pr/PrHeader.tsx';
import { aFindingsResponse, aNextStep, aPrView, aRound } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { renderInRouter } from '@/test/renderInRouter.tsx';

afterEach(restoreFetch);

const startAction: NonNullable<NextStepView['mainAction']> = {
  action: 'start_review',
  signed: false,
  optional: false,
  disabled: null,
  stage: null,
};

const newCommits = aNextStep({
  state: 'new_commits',
  banner: { code: 'state_new_commits', params: { count: 2, reviewedSha: 'abc1234def' } },
  mainAction: startAction,
});

const roundsUsed = aNextStep({
  state: 'rounds_used',
  banner: { code: 'state_rounds_used', params: { used: 3, max: 3, open: 1 } },
  mainAction: startAction,
});

describe('Start review', () => {
  test('the popover marks the repo default and posts the chosen level', async () => {
    const view = aPrView({ head: { level: { pr: null, repositoryDefault: 2, next: 2 } } });
    const { calls } = stubFetch({
      '/api/prs/wb/12': view,
      '/api/prs/wb/12/findings': aFindingsResponse(),
      'POST /api/prs/wb/12/start-review': {
        status: 201,
        body: { runId: 7, chainId: 'c', roundNumber: 1, level: 3 },
      },
    });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const header = (await screen.findByTestId('pr-meta')).closest('header')!;
    await user.click(within(header).getByRole('button', { name: /Start review/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('New chain, round 1 on abc123. Not signed.');

    await user.click(within(dialog).getByRole('combobox', { name: copy.startReview.levelLabel }));
    expect(screen.getByRole('option', { name: '2 · With context (repo default)' })).toBeVisible();
    await user.click(screen.getByRole('option', { name: '3 · Verified' }));
    await user.click(within(dialog).getByRole('button', { name: copy.startReview.button }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/prs/wb/12/start-review',
        body: { level: 3 },
        headers: expect.objectContaining({ 'X-PRA-Request': '1' }),
      }),
    );
  });

  test('while a run is active the start is disabled with the reason', async () => {
    const user = userEvent.setup();
    const view = aPrView({ round: aRound({ status: 'running' }) });
    renderInRouter(<PrHeader repo="wb" number="12" view={view} />);

    await user.click(await screen.findByRole('button', { name: /Start review/ }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: copy.startReview.button })).toBeDisabled();
    expect(dialog).toHaveTextContent(copy.startReview.running);
  });

  test('a closed PR has no Start review in its header', async () => {
    const view = aPrView();
    view.pullRequest.state = 'closed';
    renderInRouter(<PrHeader repo="wb" number="12" view={view} />);
    expect(await screen.findByTestId('pr-meta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start review/ })).not.toBeInTheDocument();
  });
});

describe('head-moved banners', () => {
  test.each([
    { name: 'new commits', step: newCommits, title: '2 new commits since last review (abc1234)' },
    { name: 'rounds used', step: roundsUsed, title: 'Automatic rounds used (3 of 3)' },
  ])('$name renders with Start review as the main action', async ({ step, title }) => {
    renderInRouter(<NextStepBanner repo="wb" number="12" view={aPrView({ nextStep: step })} />);

    const banner = await screen.findByRole('region', { name: copy.nextStep.label });
    expect(within(banner).getByRole('heading')).toHaveTextContent(title);
    expect(within(banner).getByRole('button', { name: /Start review/ })).toBeEnabled();
  });

  test('the header labels the result with the reviewed SHA and commits since', async () => {
    const view = aPrView({
      head: { reviewedSha: 'abc1234def', headSha: 'fff9999', commitsSince: 2 },
    });
    renderInRouter(<PrHeader repo="wb" number="12" view={view} />);
    expect(await screen.findByTestId('pr-meta')).toHaveTextContent(
      'Reviewed abc1234 · 2 new commits since',
    );
  });
});
