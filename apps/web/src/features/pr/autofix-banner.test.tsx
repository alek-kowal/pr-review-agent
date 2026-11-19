// S-15-T3: "Autofix waiting: <reason>" on the Next step banner, one sentence per autofix reason
// code, and the Timeline rows of autofix attempts, pushes and the level 5 shadow.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { PrView, TimelineResponse } from '@/lib/api-types.ts';
import { aFindingsResponse, aNextStep, anAuthor, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { NextStepBanner } from './NextStepBanner.tsx';

afterEach(restoreFetch);

function renderBanner(view: PrView) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextStepBanner repo="wb" number="38" view={view} />
    </QueryClientProvider>,
  );
}

/** Each code autofix (`autofixCheck`) or the push job can hold on, with its sentence. */
const REASONS: { code: string; params: Record<string, unknown>; sentence: string }[] = [
  {
    code: 'patch_touches_sensitive',
    params: { path: 'db/migrations/0001.sql', pattern: 'db/migrations/**' },
    sentence: 'Autofix waiting: patch touches a sensitive file',
  },
  {
    code: 'open_questions',
    params: { count: 2 },
    sentence: 'Autofix waiting: 2 questions to answer',
  },
  {
    code: 'unsure_verdicts',
    params: { count: 1 },
    sentence: 'Autofix waiting: 1 finding not confirmed',
  },
  {
    code: 'fix_needs_decision',
    params: { count: 1 },
    sentence: 'Autofix waiting: 1 fix needs a person to choose',
  },
  {
    code: 'fix_needs_decision',
    params: { count: 3 },
    sentence: 'Autofix waiting: 3 fixes need a person to choose',
  },
  {
    code: 'one_way_door_hold',
    params: {},
    sentence: 'Autofix waiting: a One-way door needs a person',
  },
  { code: 'autofix_paused', params: {}, sentence: 'Autofix waiting: the agent is paused' },
  {
    code: 'autofix_budget_reached',
    params: {},
    sentence: 'Autofix waiting: the daily budget is reached',
  },
  {
    code: 'head_moved_since_review',
    params: { commits: 2 },
    sentence: 'Autofix waiting: 2 new commits since the review',
  },
  {
    code: 'auto_patches_used',
    params: { used: 2, max: 2 },
    sentence: 'Autofix waiting: automatic patches used (2 of 2)',
  },
  { code: 'fork_read_only', params: {}, sentence: 'Autofix waiting: fork PRs stay read-only' },
  { code: 'autofix_trial', params: {}, sentence: 'Autofix waiting: a trial never changes the PR' },
  {
    code: 'head_moved_since_patch',
    params: {},
    sentence: 'Autofix waiting: the head moved after the patch was made',
  },
  {
    code: 'not_all_fixed',
    params: { fixed: 1, total: 2 },
    sentence: 'Autofix waiting: 1 of 2 findings fixed',
  },
  {
    code: 'reproductions_fail',
    params: { failed: 1, total: 3 },
    sentence: 'Autofix waiting: 1 of 3 reproductions still fail',
  },
  {
    code: 'autofix_findings_changed',
    params: {},
    sentence: 'Autofix waiting: someone decided a finding meanwhile',
  },
  {
    code: 'head_moved',
    params: { headSha: 'f00ba12deadbeef' },
    sentence: 'Autofix waiting: the head moved to f00ba12',
  },
  { code: 'pr_closed', params: {}, sentence: 'Autofix waiting: the PR is closed' },
  { code: 'run_active', params: {}, sentence: 'Autofix waiting: another run is active' },
  {
    code: 'patch_not_ready',
    params: { status: 'pushed' },
    sentence: 'Autofix waiting: the patch is no longer ready',
  },
  { code: 'patch_empty', params: {}, sentence: 'Autofix waiting: the patch changes no file' },
  {
    code: 'no_implement_decisions',
    params: {},
    sentence: 'Autofix waiting: no finding to implement',
  },
];

const waitingOn = (reason: { code: string; params: Record<string, unknown> }) =>
  aPrView({
    author: anAuthor({ name: 'Kasia', memberId: 'm1' }),
    nextStep: aNextStep({
      state: 'patch_ready',
      banner: { code: 'state_autofix_waiting', params: { reason } },
      mainAction: { action: 'push', signed: true, optional: false, disabled: null, stage: null },
    }),
  });

describe('the autofix waiting banner', () => {
  test.each(REASONS)('$code $params: "$sentence"', ({ code, params, sentence }) => {
    renderBanner(waitingOn({ code, params }));

    const banner = screen.getByRole('region', { name: copy.nextStep.label });
    expect(within(banner).getByRole('heading', { level: 2 })).toHaveTextContent(sentence);
  });

  test('an unknown code reads as its words, never as a raw code', () => {
    renderBanner(waitingOn({ code: 'some_new_hold', params: {} }));

    const banner = screen.getByRole('region', { name: copy.nextStep.label });
    expect(within(banner).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Autofix waiting: some new hold',
    );
  });
});

const bot = { kind: 'bot' } as const;
const entry = (id: number, kind: string, params: Record<string, unknown>) => ({
  id,
  at: `2026-11-19T10:0${id}:00.000Z`,
  actor: bot,
  memberName: null,
  kind,
  params,
  runId: null,
  costUsd: null,
});

const TIMELINE: TimelineResponse = {
  summary: {
    readyAt: '2026-11-19T09:00:00.000Z',
    outcome: 'open',
    totalMs: 0,
    agentsWorkedMs: 0,
    waitingMs: 0,
    byLane: { agents: 0, people: 0 },
    costUsd: 0,
  },
  entries: [
    entry(1, 'autofix_started', { findingIds: [1, 2] }),
    entry(2, 'autofix_pushed', { sha: 'abc1234def5678', branch: 'edge-labels', patchId: 7 }),
    entry(3, 'autofix_waiting', {
      point: 'push',
      reason: { code: 'patch_touches_sensitive', params: { path: 'a', pattern: 'b' } },
    }),
    entry(4, 'autofix_shadow', { decision: 'would_push', fixed: 2, total: 2 }),
    entry(5, 'autofix_shadow', {
      decision: 'would_wait',
      reason: { code: 'open_questions', params: { count: 1 } },
    }),
  ],
};

describe('autofix rows on the Timeline', () => {
  test('attempts, pushes and shadow entries read as sentences by the bot', async () => {
    stubFetch({
      '/api/prs/wb/38': aPrView(),
      '/api/prs/wb/38/findings': aFindingsResponse(),
      '/api/prs/wb/38/timeline': TIMELINE,
    });
    renderApp('/pr/wb/38?tab=timeline');

    const list = await screen.findByRole('list', { name: copy.timeline.entriesLabel });
    const rows = within(list).getAllByRole('listitem');
    const texts = rows.map((row) => row.textContent ?? '');
    const expected = [
      'Autofix started by pr-review-agent',
      'Autofix pushed abc1234',
      'Autofix waiting: patch touches a sensitive file',
      'Level 5 would have fixed 2 of 2 and pushed',
      'Level 5 would have waited: 1 question to answer',
    ];
    for (const sentence of expected) {
      expect(texts.some((text) => text.includes(sentence))).toBe(true);
    }
    for (const row of rows) {
      expect(within(row).getByTestId('entry-actor')).toHaveTextContent(copy.timeline.actor.bot);
    }
  });
});
