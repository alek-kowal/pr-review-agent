import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { NextStepView, PrView } from '@/lib/api-types.ts';
import { aFinding, aFindingsResponse, aNextStep, anAuthor, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { NextStepBanner } from './NextStepBanner.tsx';

afterEach(restoreFetch);

/** The banner reads the status (who paused) through a query. */
function renderBanner(view: PrView) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextStepBanner repo="wb" number="12" view={view} />
    </QueryClientProvider>,
  );
}

const action = (code: NonNullable<NextStepView['mainAction']>['action'], signed = false) => ({
  action: code,
  signed,
  optional: false,
  disabled: null,
  stage: null,
});

const FIXTURES: {
  name: string;
  step: NextStepView;
  title: string;
  meta: string;
  tone: string;
  button: string | null;
}[] = [
  {
    name: 'decide',
    step: aNextStep(),
    title: 'Decide 3 findings',
    meta: 'Next step · usually Kasia (author)',
    tone: 'bg-warn-bg',
    button: 'Decide findings',
  },
  {
    name: 'to implement',
    step: aNextStep({
      state: 'waiting_for_fix',
      banner: { code: 'state_waiting_for_fix', params: { count: 2 } },
      mainAction: action('implement_with_agent', true),
    }),
    title: '2 findings to implement',
    meta: 'Next step · usually Kasia (author)',
    tone: 'bg-warn-bg',
    button: null,
  },
  {
    name: 'running',
    step: aNextStep({
      state: 'round_running',
      lane: 'agents_working',
      tone: 'working',
      banner: { code: 'state_round_starting', params: { roundNumber: 1, max: 3 } },
      who: { code: 'who_no_one_needs_to_act', params: {} },
      mainAction: action('cancel'),
    }),
    title: 'Review starting: PR marked ready for review (round 1 of 3)',
    meta: 'Next step · no one needs to act',
    tone: 'bg-brand-bg',
    button: null,
  },
  {
    name: 'failed',
    step: aNextStep({
      state: 'stage_failed',
      tone: 'failed',
      banner: {
        code: 'state_stage_failed',
        params: { stage: 'review', errorCode: 'stage_timeout', roundNumber: 1 },
      },
      who: { code: 'who_anyone_can_retry', params: {} },
      mainAction: { ...action('retry'), stage: 'review' },
    }),
    title: 'Round 1 failed at Review: the stage ran out of time',
    meta: 'Next step · anyone can retry',
    tone: 'bg-bad-bg',
    button: null,
  },
  {
    name: 'ready',
    step: aNextStep({
      state: 'ready_to_merge',
      lane: 'ready_to_merge',
      tone: 'ready',
      banner: { code: 'state_ready_to_merge', params: { sha: 'abc1234def' } },
      who: { code: 'who_usually_author', params: {} },
      mainAction: action('merge', true),
    }),
    title: 'Ready to merge at abc1234',
    meta: 'Next step · usually Kasia (author)',
    tone: 'bg-ok-bg',
    button: 'Merge #12…',
  },
];

describe('the Next step banner', () => {
  test.each(FIXTURES)(
    '$name: copy, tone and main action',
    ({ step, title, meta, tone, button }) => {
      const view = aPrView({ nextStep: step, author: anAuthor({ name: 'Kasia', memberId: 'm1' }) });
      renderBanner(view);

      const banner = screen.getByRole('region', { name: copy.nextStep.label });
      expect(within(banner).getByRole('heading', { level: 2 })).toHaveTextContent(title);
      expect(banner).toHaveTextContent(meta);
      expect(banner).toHaveClass(tone);
      expect(banner).toHaveAttribute('data-tone', step.tone);
      const buttons = within(banner).queryAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(button ? [button] : []);
    },
  );

  test('a merged PR shows its state without a Next step line', () => {
    const step = aNextStep({
      state: 'merged',
      lane: null,
      tone: 'neutral',
      banner: { code: 'state_merged', params: { by: null } },
      who: { code: 'who_nobody', params: {} },
      mainAction: null,
    });
    renderBanner(aPrView({ nextStep: step }));

    const banner = screen.getByRole('region', { name: copy.nextStep.stateLabel });
    expect(banner).toHaveTextContent('Merged');
    expect(banner).not.toHaveTextContent(copy.nextStep.label);
  });

  test('Decide findings opens and focuses the first finding to decide', async () => {
    const decided = aFinding({
      id: 1,
      severity: 'blocking',
      needsDecision: { needed: false, reason: { code: 'decided', params: {} } },
    });
    const nit = aFinding({ id: 2, severity: 'nit' });
    const first = aFinding({ id: 3, severity: 'blocking', title: 'Undo loses the group' });
    const later = aFinding({ id: 4, severity: 'worth_fixing' });
    stubFetch({
      '/api/prs/wb/12': aPrView(),
      '/api/prs/wb/12/findings': aFindingsResponse({ findings: [later, nit, first, decided] }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/pr/wb/12?tab=questions');

    await user.click(await screen.findByRole('button', { name: copy.nextStep.actions.decide }));

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'findings' }));
    const line = await screen.findByRole('button', { name: /Undo loses the group/ });
    await waitFor(() => expect(line).toHaveFocus());
    expect(line).toHaveAttribute('aria-expanded', 'true');
  });
});
