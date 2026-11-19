// S-04-T6: Run detail shows the Checks output (CI counts, install result) and the Change type
// output (the type and how it was set, the rules' and judge's answers, the large-PR warning).
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunDetail, RunStageView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const at = '2026-11-19T10:00:00.000Z';

const stage = (key: string, output: unknown): RunStageView => ({
  key,
  status: 'done',
  attempt: 1,
  costUsd: 0,
  errorCode: null,
  offReason: null,
  startedAt: at,
  finishedAt: at,
  output,
  sessions: [],
  reused: false,
});

const CHECKS = {
  ci: { passed: 4, failed: 1, pending: 2, checks: [] },
  install: {
    status: 'failed',
    failedStep: 'install',
    fetch: { exitCode: 0 },
    install: { exitCode: 1 },
    logBlobKey: 'logs/1',
  },
};

const CHANGE_TYPE = {
  changeType: 'changes_behaviour',
  reason: { code: 'judge_raised', params: {} },
  rules: { changeType: 'uses_existing', reason: { code: 'paths_uses_existing', params: {} } },
  judge: { changeType: 'changes_behaviour', reason: 'It changes how edges are labelled.' },
  judgeSkipped: null,
  forced: null,
  needsPerson: false,
  lines: 1240,
  largePr: true,
  largePrLines: 800,
};

const DETAIL: RunDetail = {
  run: {
    id: 51,
    kind: 'round',
    status: 'completed',
    level: { number: 2, key: 'context' },
    startedBy: { kind: 'bot' },
    trigger: 'ready',
    createdAt: at,
    startedAt: at,
    finishedAt: at,
    currentStage: null,
    notChecked: [],
    instructionVersions: [],
    error: null,
    retryOf: null,
    retryFrom: null,
    retriedBy: null,
  },
  pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
  label: null,
  stages: [stage('checks', CHECKS), stage('change_type', CHANGE_TYPE)],
  totalCostUsd: 0.05,
};

afterEach(restoreFetch);

/** Opens Run detail and expands both stages (only Review opens by default). */
async function openRun() {
  const user = userEvent.setup();
  const { container } = renderApp('/runs/51');
  await screen.findByRole('heading', { name: /Round/ });
  for (const key of ['checks', 'change_type']) {
    const row = container.querySelector(`[data-stage="${key}"]`) as HTMLElement;
    await user.click(within(row).getAllByRole('button')[0]!);
  }
}

describe('Checks and Change type in Run detail', () => {
  it('shows CI counts and the install result with its exit code', async () => {
    stubFetch({ '/api/runs/51': DETAIL });
    await openRun();

    const checks = await screen.findByTestId('checks-output');
    expect(checks).toHaveTextContent('4 passed · 1 failed · 2 pending');
    expect(checks).toHaveTextContent('Install failed · exit 1');
  });

  it('shows the change type, how it was set, both answers and the large-PR warning', async () => {
    stubFetch({ '/api/runs/51': DETAIL });
    await openRun();

    const output = await screen.findByTestId('change-type-output');
    expect(output).toHaveTextContent('Changes behaviour · raised by the judge');
    expect(output).toHaveTextContent('RulesUses existing parts');
    expect(output).toHaveTextContent('It changes how edges are labelled.');
    expect(within(output).getByTestId('large-pr-warning')).toHaveTextContent(
      '1240 changed lines, over the 800-line limit. Consider splitting it into smaller PRs.',
    );
  });

  it('a round without CI checks says so, and a skipped judge reads as such', async () => {
    stubFetch({
      '/api/runs/51': {
        ...DETAIL,
        stages: [
          stage('checks', { ...CHECKS, ci: { passed: 0, failed: 0, pending: 0, checks: [] } }),
          stage('change_type', {
            ...CHANGE_TYPE,
            reason: { code: 'rules_floor', params: {} },
            judge: null,
            judgeSkipped: { code: 'floor_is_highest', params: {} },
            largePr: false,
          }),
        ],
      },
    });
    await openRun();

    expect(await screen.findByTestId('checks-output')).toHaveTextContent(
      'No CI checks on this commit',
    );
    const output = screen.getByTestId('change-type-output');
    expect(output).toHaveTextContent('set by the rules');
    expect(output).toHaveTextContent('Judge did not run');
    expect(within(output).queryByTestId('large-pr-warning')).toBeNull();
  });
});
