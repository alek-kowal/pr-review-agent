// S-09-T2: Run detail of a retry marks the stages it reused and links the failed run with what
// it spent up to the failure; the failed run links its retry.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunDetail, RunStageView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const at = (minute: number) => `2026-11-19T10:${String(minute).padStart(2, '0')}:00.000Z`;

const stage = (key: string, over: Partial<RunStageView> = {}): RunStageView => ({
  key,
  status: 'done',
  attempt: 1,
  costUsd: 0,
  errorCode: null,
  offReason: null,
  offSteps: [],
  startedAt: at(1),
  finishedAt: at(2),
  output: null,
  sessions: [],
  reused: false,
  ...over,
});

const run = (over: Partial<RunDetail['run']>): RunDetail['run'] => ({
  id: 42,
  kind: 'round',
  status: 'running',
  level: { number: 2, key: 'context' },
  startedBy: { kind: 'hand' },
  trigger: 'manual',
  createdAt: at(10),
  startedAt: at(10),
  finishedAt: null,
  currentStage: 'review',
  notChecked: [],
  instructionVersions: [],
  error: null,
  models: [],
  retryOf: null,
  retryFrom: null,
  retriedBy: null,
  ...over,
});

const detail = (r: RunDetail['run'], stages: RunStageView[], totalCostUsd: number): RunDetail => ({
  run: r,
  pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
  label: null,
  stages,
  totalCostUsd,
});

const RETRY = detail(
  run({ retryOf: { id: 41, status: 'failed', costUsd: 0.42 }, retryFrom: 'review' }),
  [
    stage('checks', { reused: true, output: { summary: 'checks done' } }),
    stage('task', { reused: true }),
    stage('review', { status: 'running', finishedAt: null }),
  ],
  0,
);

const FAILED = detail(
  run({
    id: 41,
    status: 'failed',
    finishedAt: at(9),
    currentStage: null,
    error: { stage: 'review', code: 'stage_timeout' },
    retriedBy: { id: 42, status: 'running', costUsd: 0 },
  }),
  [
    stage('checks'),
    stage('task'),
    stage('review', { status: 'failed', errorCode: 'stage_timeout', costUsd: 0.42 }),
  ],
  0.42,
);

afterEach(restoreFetch);

describe('Run detail of a retry', () => {
  it('marks reused stages and links the failed run with its cost up to the failure', async () => {
    stubFetch({ '/api/runs/42': RETRY });
    const { container } = renderApp('/runs/42');

    const retryOf = await screen.findByTestId('run-retry-of');
    expect(retryOf).toHaveTextContent(
      'Retry from Review of failed run #41 · $0.42 spent up to the failure',
    );
    expect(within(retryOf).getByRole('link', { name: 'failed run #41' })).toHaveAttribute(
      'href',
      '/runs/41',
    );

    const row = (key: string) => container.querySelector(`[data-stage="${key}"]`) as HTMLElement;
    expect(row('checks')).toHaveTextContent('reused from the failed round');
    expect(row('task')).toHaveTextContent('reused from the failed round');
    expect(row('review')).not.toHaveTextContent('reused from the failed round');
  });

  it('a failed run links the retry that repeated it', async () => {
    stubFetch({ '/api/runs/41': FAILED });
    renderApp('/runs/41');

    const retriedBy = await screen.findByTestId('run-retried-by');
    expect(within(retriedBy).getByRole('link', { name: 'run #42' })).toHaveAttribute(
      'href',
      '/runs/42',
    );
    expect(screen.queryByText('reused from the failed round')).toBeNull();
  });
});
