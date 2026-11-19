import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { NextStepView } from '@/lib/api-types.ts';
import {
  aChecklist,
  aFinding,
  aFindingsResponse,
  aNextStep,
  anAuthor,
  aPrView,
} from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { Checklist } from './Checklist.tsx';
import { NextStepBanner } from './NextStepBanner.tsx';

afterEach(restoreFetch);

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
    button: 'Cancel',
  },
  {
    name: 'failed',
    step: aNextStep({
      state: 'stage_failed',
      tone: 'failed',
      banner: {
        code: 'state_stage_failed',
        params: { stage: 'review', errorCode: 'stage_timeout', roundNumber: 1, timeoutMinutes: 30 },
      },
      who: { code: 'who_anyone_can_retry', params: {} },
      mainAction: { ...action('retry'), stage: 'review' },
    }),
    title: 'Review stage timed out after 30 min. This round is not counted',
    meta: 'Next step · anyone can retry',
    tone: 'bg-bad-bg',
    button: 'Retry from Review',
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
    button: null,
  },
];

describe('the Next step banner', () => {
  test.each(FIXTURES)(
    '$name: copy, tone and main action',
    ({ step, title, meta, tone, button }) => {
      const view = aPrView({ nextStep: step, author: anAuthor({ name: 'Kasia', memberId: 'm1' }) });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <NextStepBanner repo="wb" number="12" view={view} />
        </QueryClientProvider>,
      );

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
    render(<NextStepBanner repo="wb" number="12" view={aPrView({ nextStep: step })} />);

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

describe('the merge checklist', () => {
  const items = aChecklist().items;

  test('shows failing rows only, and every row behind "Show all N"', async () => {
    const user = userEvent.setup();
    render(<Checklist repo="wb" number="12" view={aPrView({ checklist: aChecklist() })} />);

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('3 findings to decide.');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all 2' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('The review covers abc1234, the head commit.');
  });

  test('all green is one line that opens the list', async () => {
    const green = { ok: true, items: items.map((i) => ({ ...i, ok: true })) };
    const user = userEvent.setup();
    render(<Checklist repo="wb" number="12" view={aPrView({ checklist: green })} />);

    const line = screen.getByRole('button', { name: /Merge checklist/ });
    expect(line).toHaveTextContent('2 of 2');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    await user.click(line);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
  });
});
