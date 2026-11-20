import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { RunDetail, RunSessionView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aStatus } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const session = (over: Partial<RunSessionView> & { id: number }): RunSessionView => ({
  role: 'judge',
  model: 'claude-sonnet-5-5',
  provider: 'anthropic',
  answeredModel: null,
  status: 'completed',
  costUsd: 0.1,
  costSource: 'reported',
  turns: 3,
  durationMs: 4000,
  tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 },
  filesRead: [],
  actions: [],
  hasTranscript: false,
  ...over,
});

const at = (minute: number) => `2026-11-19T10:0${minute}:00.000Z`;

// A failed level 2 round: Review timed out after spending $0.30.
const FAILED_RUN: RunDetail = {
  run: {
    id: 41,
    kind: 'round',
    status: 'failed',
    level: { number: 2, key: 'context' },
    startedBy: { kind: 'bot' },
    trigger: 'ready_for_review',
    createdAt: at(0),
    startedAt: at(0),
    finishedAt: at(9),
    currentStage: null,
    notChecked: [],
    instructionVersions: [{ id: 7, scope: 'global', fileKey: 'review-rules.md', version: 3 }],
    error: { stage: 'review', code: 'stage_timeout' },
    models: [
      { role: 'reviewer', model: 'claude-opus-5-5', source: 'level', level: 2 },
      { role: 'verifier', model: 'claude-haiku-5-5', source: 'settings', level: null },
    ],
    retryOf: null,
    retryFrom: null,
    retriedBy: null,
  },
  pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
  label: {
    code: 'round_label',
    params: {
      roundNumber: 1,
      max: 3,
      trigger: 'ready_for_review',
      startedBy: { kind: 'bot' },
      fixSha: null,
      newChain: false,
    },
  },
  stages: [
    {
      key: 'checks',
      status: 'done',
      attempt: 1,
      costUsd: 0,
      errorCode: null,
      offReason: null,
      offSteps: [],
      startedAt: at(1),
      finishedAt: at(2),
      output: { summary: 'checks done' },
      sessions: [],
      reused: false,
    },
    {
      key: 'task',
      status: 'done',
      attempt: 1,
      costUsd: 0.1,
      errorCode: null,
      offReason: null,
      offSteps: [],
      startedAt: at(2),
      finishedAt: at(3),
      output: {
        status: 'linked',
        how: 'branch',
        task: {
          id: 'abc',
          customId: 'WB-812',
          name: 'Group nodes',
          url: 'https://app.clickup.com/t/abc',
          status: 'in progress',
          description: 'Users group nodes with a frame.',
        },
      },
      sessions: [session({ id: 1, costUsd: 0.1 })],
      reused: false,
    },
    {
      key: 'review',
      status: 'failed',
      attempt: 1,
      costUsd: 0.3,
      errorCode: 'stage_timeout',
      offReason: null,
      offSteps: [],
      startedAt: at(4),
      finishedAt: at(9),
      output: null,
      sessions: [
        session({
          id: 2,
          role: 'reviewer',
          status: 'failed',
          costUsd: 0.3,
          turns: 211,
          filesRead: ['apps/demo/src/edges.ts'],
          actions: [{ tool: 'Grep', target: 'onRename' }],
          hasTranscript: true,
        }),
      ],
      reused: false,
    },
    {
      key: 'verify',
      status: 'off',
      attempt: null,
      costUsd: 0,
      errorCode: null,
      offReason: { code: 'off_at_level', params: { level: 2 } },
      offSteps: [],
      startedAt: null,
      finishedAt: null,
      output: null,
      sessions: [],
      reused: false,
    },
  ],
  totalCostUsd: 0.4,
};

const TRANSCRIPT = [
  { type: 'system', subtype: 'init' },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Reading the diff first.' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'apps/demo/src/edges.ts' } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'onRename' } },
      ],
    },
  },
  {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', content: 'File not found', is_error: true }],
    },
  },
];

function stub() {
  return stubFetch({
    '/api/runs/41': FAILED_RUN,
    '/api/runs/41/sessions/2/transcript': TRANSCRIPT,
  });
}

afterEach(restoreFetch);

describe('Run detail', () => {
  it('names the stages that read each frozen file (STAGEFILES)', async () => {
    stubFetch({
      '/api/runs/41': {
        ...FAILED_RUN,
        run: {
          ...FAILED_RUN.run,
          instructionVersions: [
            { id: 7, scope: 'global', fileKey: 'review-rules.md', version: 3 },
            { id: 8, scope: 'repository', fileKey: 'verify-b-rules.md', version: 1 },
          ],
          stageFiles: {
            review: { prompt: null, rules: 'review-rules.md', documents: [] },
            verify: { prompt: 'prompt-verifier.md', rules: 'verify-b-rules.md', documents: [] },
          },
        },
      } satisfies RunDetail,
    });
    renderApp('/runs/41');
    const file = await screen.findByText('verify-b-rules.md');
    expect(file.parentElement).toHaveTextContent(copy.runs.detail.readBy(['Verify']));
    expect(screen.getByText('review-rules.md').parentElement).toHaveTextContent(
      copy.runs.detail.readBy(['Review']),
    );
  });

  it('shows a failed run with its cost up to the failure and the stage that failed', async () => {
    stub();
    renderApp('/runs/41');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Round 1 of 3 on #12' }),
    ).toBeVisible();
    expect(screen.getByTestId('run-cost')).toHaveTextContent('$0.40 up to the failure');
    expect(screen.getByTestId('run-meta')).toHaveTextContent(
      'Failed, not counted · started by PR Review Agent · level 2 · 9 min',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed at Review: the stage ran out of time.',
    );
    expect(screen.getByRole('link', { name: '#12 Add node grouping' })).toHaveAttribute(
      'href',
      '/pr/wb/12',
    );
    expect(screen.getByText('review-rules.md')).toBeVisible();
    // S-21-T2: the models the run used, with where each came from.
    const models = screen.getByRole('list', { name: 'Models' });
    expect(models).toHaveTextContent('Reviewerclaude-opus-5-5Level 2');
    expect(models).toHaveTextContent('Verifierclaude-haiku-5-5Settings');
  });

  it('lists the sessions with their cost and files read; stages expand to their output', async () => {
    stub();
    renderApp('/runs/41');
    const reviewer = await screen.findByRole('region', { name: 'Reviewer' });
    expect(reviewer).toHaveTextContent('$0.30');
    expect(reviewer).toHaveTextContent('211 turns · 1 file read · 1 action · failed');
    await userEvent.click(within(reviewer).getByText('Files read'));
    expect(within(reviewer).getByText('apps/demo/src/edges.ts')).toBeVisible();

    const costs = screen.getByRole('list', { name: 'Cost per session' });
    expect(costs).toHaveTextContent('Task · Judge$0.10');
    expect(costs).toHaveTextContent('Review · Reviewer$0.30');

    const task = screen.getByRole('button', { name: /Task/ });
    expect(task).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(task);
    expect(screen.getByTestId('task-output')).toHaveTextContent('WB-812 Group nodes');
    expect(screen.getByTestId('task-output')).toHaveTextContent('Users group nodes with a frame.');

    await userEvent.click(screen.getByRole('button', { name: /Verify/ }));
    expect(screen.getByText('Off at level 2.')).toBeVisible();
  });

  it('the transcript tab renders what the agent said and its tool calls', async () => {
    stub();
    renderApp('/runs/41?tab=transcript');
    const log = await screen.findByRole('region', { name: 'Review · Reviewer' });
    expect(await within(log).findByText('Reading the diff first.')).toBeVisible();
    const tools = within(log)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.kind === 'tool');
    expect(tools.map((li) => li.textContent)).toEqual([
      'Readapps/demo/src/edges.ts',
      'GreponRename',
    ]);
    expect(within(log).getByText('File not found')).toHaveClass('text-bad');
    expect(screen.getByRole('region', { name: 'Task · Judge' })).toHaveTextContent(
      'This session has no stored transcript.',
    );
  });

  it('an unknown run says so', async () => {
    stubFetch({
      '/api/runs/99': { status: 404, body: { error: { code: 'run_not_found', params: {} } } },
    });
    renderApp('/runs/99');
    expect(await screen.findByRole('heading', { name: 'This run does not exist.' })).toBeVisible();
  });

  it('shows each judge call and the fallback to Claude; OpenRouter cost is spend (P-26)', async () => {
    const JEV = 'openrouter/typesafe/jev-router';
    const changeType = {
      ...FAILED_RUN.stages[0]!,
      key: 'change_type',
      costUsd: 0.0012,
      output: {
        changeType: 'changes_behaviour',
        reason: { code: 'judge_raised', params: {} },
        rules: { changeType: 'uses_existing', reason: { code: 'paths_uses_existing', params: {} } },
        judge: { changeType: 'changes_behaviour', reason: 'Claude says so.' },
        judgeSkipped: null,
        judgeFallback: {
          from: JEV,
          to: 'claude-haiku-5-5',
          reason: { code: 'openrouter_no_credits', params: { status: 402 } },
        },
        forced: null,
        needsPerson: false,
        lines: 12,
        largePr: false,
        largePrLines: 800,
      },
      sessions: [
        session({
          id: 7,
          model: JEV,
          provider: 'openrouter',
          answeredModel: 'acme/routed-small',
          status: 'failed',
          costUsd: 0.0002,
          turns: 1,
          durationMs: 1200,
          tokens: { input: 1100, output: 0, cacheRead: 100, cacheWrite: 0 },
        }),
        session({ id: 8, model: 'claude-haiku-5-5', costUsd: 0.001, turns: 1, durationMs: 900 }),
      ],
    };
    stubFetch({
      '/api/status': aStatus({ modelAuth: 'subscription' }),
      '/api/runs/41': { ...FAILED_RUN, stages: [changeType] },
    });
    renderApp('/runs/41');

    await userEvent.click(await screen.findByRole('button', { name: /Change type/ }));
    const [openRouter, claude] = await screen.findAllByRole('region', { name: 'Judge' });
    // Billed spend: no "API-equivalent", even on a subscription.
    expect(openRouter).toHaveTextContent('$0.00');
    expect(openRouter).not.toHaveTextContent('API-equivalent');
    expect(within(openRouter!).getByTestId('judge-trace')).toHaveTextContent(
      `OpenRouter · asked ${JEV} · answered by acme/routed-small · 1,200 in / 0 out tokens · 1 s · $0.0002 billed by OpenRouter`,
    );
    expect(within(claude!).getByTestId('judge-trace')).toHaveTextContent(
      'Claude · asked claude-haiku-5-5 · 100 in / 20 out tokens',
    );
    expect(within(claude!).getByTestId('judge-trace')).toHaveTextContent('$0.0010 API-equivalent');

    expect(screen.getByTestId('change-type-output')).toHaveTextContent(
      `${JEV} failed: no OpenRouter credits left. claude-haiku-5-5 answered instead.`,
    );
  });
});
