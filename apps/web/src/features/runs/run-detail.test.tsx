import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunDetail, RunSessionView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const session = (over: Partial<RunSessionView> & { id: number }): RunSessionView => ({
  role: 'judge',
  model: 'claude-sonnet-5-5',
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
});
