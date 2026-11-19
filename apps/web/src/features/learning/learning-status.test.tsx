// S-23-T6: a closed PR's banner shows "Merged by …" and the learning line (running, finished with
// N candidates and a link to Learning, or failed); every closed PR has an unsigned "Run analyst".
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { LearningSectionView, PrView } from '@/lib/api-types.ts';
import { aFindingsResponse, aNextStep, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const merged = (learning: LearningSectionView): PrView =>
  aPrView({
    state: 'merged',
    nextStep: aNextStep({
      state: 'merged',
      lane: null,
      tone: 'neutral',
      banner: { code: 'state_merged', params: { by: null } },
      who: { code: 'who_nobody', params: {} },
      mainAction: null,
    }),
    learning,
  });

const analysis = (patch: Partial<NonNullable<LearningSectionView['analysis']>>) => ({
  levelLearns: true,
  analysis: {
    id: 4,
    status: 'running' as const,
    startedBy: 'bot' as const,
    candidates: null,
    runId: 31,
    at: '2026-11-19T10:00:00.000Z',
    ...patch,
  },
});

function serve(view: PrView, routes: Record<string, unknown> = {}) {
  return stubFetch({
    '/api/prs/wb/12': view,
    '/api/prs/wb/12/findings': aFindingsResponse(),
    ...routes,
  });
}

const banner = () => screen.findByRole('region', { name: copy.nextStep.stateLabel });

afterEach(() => restoreFetch());

describe('Learning status on a closed PR', () => {
  test.each([
    ['running', analysis({}), 'Learning: Analyst is running'],
    [
      'finished',
      analysis({ status: 'finished', candidates: 3 }),
      'Learning: Analyst finished: 3 candidates',
    ],
    ['failed', analysis({ status: 'failed' }), 'Learning: Analyst failed'],
  ])('%s', async (_status, learning, line) => {
    serve(merged(learning));
    renderApp('/pr/wb/12');

    const region = await banner();
    expect(region).toHaveTextContent('Merged');
    expect(await within(region).findByTestId('learning-line')).toHaveTextContent(line);
  });

  test('finished links to Settings → Learning', async () => {
    serve(merged(analysis({ status: 'finished', candidates: 1 })));
    renderApp('/pr/wb/12');

    const line = await within(await banner()).findByTestId('learning-line');
    expect(line).toHaveTextContent('Analyst finished: 1 candidate');
    expect(
      within(line).getByRole('link', { name: copy.learning.status.openLearning }),
    ).toHaveAttribute('href', '/settings/learning');
  });

  test('a closed PR without an analysis shows no learning line', async () => {
    serve(merged({ levelLearns: false, analysis: null }));
    renderApp('/pr/wb/12');

    await banner();
    expect(screen.queryByTestId('learning-line')).toBeNull();
  });

  test('"Run analyst" sends an unsigned request', async () => {
    const { calls } = serve(merged({ levelLearns: false, analysis: null }), {
      'POST /api/prs/wb/12/analyst': { status: 202, body: { analysisId: 5, runId: 40 } },
    });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    await user.click(await screen.findByRole('button', { name: copy.learning.runAnalyst.button }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/prs/wb/12/analyst',
      }),
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toBeUndefined();
    expect(post.headers).toMatchObject({ 'X-PRA-Request': '1' });
  });

  test('an open PR has no "Run analyst"', async () => {
    serve(aPrView());
    renderApp('/pr/wb/12');

    await screen.findByTestId('next-step');
    expect(screen.queryByRole('button', { name: copy.learning.runAnalyst.button })).toBeNull();
  });
});
