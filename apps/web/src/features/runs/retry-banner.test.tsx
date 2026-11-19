// S-09-T2: the Stage failed banner's main action is "Retry from <stage>", with the failure text.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { NextStepBanner } from '@/features/pr/NextStepBanner.tsx';
import type { NextStepView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aNextStep, aPrView, aRound } from '@/test/fixtures.ts';
import { renderInRouter } from '@/test/renderInRouter.tsx';

afterEach(restoreFetch);

const failedStep = (params: Record<string, unknown>): NextStepView =>
  aNextStep({
    state: 'stage_failed',
    tone: 'failed',
    banner: { code: 'state_stage_failed', params: { stage: 'review', roundNumber: 1, ...params } },
    who: { code: 'who_anyone_can_retry', params: {} },
    mainAction: {
      action: 'retry',
      signed: false,
      optional: false,
      disabled: null,
      stage: 'review',
    },
  });

function renderBanner(step: NextStepView) {
  const view = aPrView({
    nextStep: step,
    round: aRound({ id: 41, status: 'failed', error: { stage: 'review', code: 'stage_timeout' } }),
  });
  renderInRouter(<NextStepBanner repo="wb" number="12" view={view} />);
  return screen.findByRole('region', { name: copy.nextStep.label });
}

describe('Retry from the failed stage', () => {
  test('a timeout says how long the stage ran and that the round is not counted', async () => {
    const banner = await renderBanner(
      failedStep({ errorCode: 'stage_timeout', timeoutMinutes: 30 }),
    );
    expect(within(banner).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Review stage timed out after 30 min. This round is not counted',
    );
  });

  test('a restart names the stage and why it failed', async () => {
    const banner = await renderBanner(failedStep({ errorCode: 'interrupted_by_restart' }));
    expect(within(banner).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Round 1 failed at Review: the app restarted while it ran. This round is not counted',
    );
  });

  test('Retry from Review retries the failed round, unsigned', async () => {
    const { calls } = stubFetch({
      'POST /api/runs/41/retry': { status: 201, body: { run: { id: 42, fromStage: 'review' } } },
    });
    const user = userEvent.setup();
    const banner = await renderBanner(
      failedStep({ errorCode: 'stage_timeout', timeoutMinutes: 30 }),
    );

    await user.click(within(banner).getByRole('button', { name: 'Retry from Review' }));

    await expect
      .poll(() => calls.find((c) => c.method === 'POST'))
      .toMatchObject({
        path: '/api/runs/41/retry',
        headers: { 'X-PRA-Request': '1' },
      });
    expect(calls.find((c) => c.method === 'POST')?.body).toBeUndefined();
  });
});
