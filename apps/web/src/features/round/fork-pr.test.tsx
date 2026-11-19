// S-16-T3: a fork PR's Start review note and its steps "off for forks" in the stepper and Run
// detail; nothing changes for a PR from the same repository.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { StageList } from '@/features/runs/StageList.tsx';
import type { OffStepView, RunDetail, RunStageView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { aStep } from '@/test/round-fixtures.ts';
import { Stepper } from './Stepper.tsx';

afterEach(restoreFetch);

const FORK = { code: 'fork_read_only', params: {} };
const off = (step: string): OffStepView[] => [{ step, reason: FORK }];

const forkSteps = (fork: boolean) => [
  aStep({ key: 'checks', status: 'done', offSteps: fork ? off('install') : [] }),
  aStep({ key: 'review', status: 'running' }),
  aStep({ key: 'verify', status: 'queued', offSteps: fork ? off('reproductions') : [] }),
];

const item = (name: string) =>
  within(screen.getByRole('list', { name: copy.runs.stepperLabel }))
    .getAllByRole('listitem')
    .find((li) => li.textContent?.startsWith(name))!;

const stage = (over: Partial<RunStageView> & { key: string }): RunStageView => ({
  status: 'queued',
  attempt: null,
  costUsd: 0,
  errorCode: null,
  offReason: null,
  offSteps: [],
  startedAt: null,
  finishedAt: null,
  output: null,
  sessions: [],
  reused: false,
  ...over,
});

const runDetail = (stages: RunStageView[]): RunDetail => ({
  run: {
    id: 41,
    kind: 'round',
    status: 'running',
    level: { number: 4, key: 'implement' },
    startedBy: { kind: 'hand' },
    trigger: 'manual',
    createdAt: '2026-11-19T10:00:00.000Z',
    startedAt: '2026-11-19T10:00:00.000Z',
    finishedAt: null,
    currentStage: 'review',
    notChecked: [],
    instructionVersions: [],
    error: null,
    models: [],
    retryOf: null,
    retryFrom: null,
    retriedBy: null,
  },
  pullRequest: { repository: { slug: 'wb' }, number: 12, title: 'Add node grouping' },
  label: null,
  stages,
  totalCostUsd: 0,
});

describe('fork PR', () => {
  test('the stepper names the steps a fork turns off', () => {
    render(<Stepper steps={forkSteps(true)} level={4} runFailed={false} />);
    expect(item('Checks')).toHaveTextContent('Install: off for forks');
    expect(item('Verify')).toHaveTextContent('Reproductions: off for forks');
    expect(item('Review')).not.toHaveTextContent('off for forks');
  });

  test("a fork fix check's Reproductions stage is off for forks, not off at a level", () => {
    render(
      <Stepper
        steps={[aStep({ key: 'reproductions', status: 'off', offReason: FORK })]}
        level={4}
        runFailed={false}
      />,
    );
    expect(item('Reproductions')).toHaveTextContent('off for forks');
    expect(item('Reproductions')).not.toHaveTextContent('off at level');
  });

  test('a PR from the same repository shows no off steps', () => {
    render(<Stepper steps={forkSteps(false)} level={4} runFailed={false} />);
    expect(screen.queryAllByTestId('off-step')).toHaveLength(0);
    expect(screen.getByRole('list')).not.toHaveTextContent('off for forks');
  });

  test('Run detail shows install and reproductions off for forks', async () => {
    const user = userEvent.setup();
    render(
      <StageList
        detail={runDetail([
          stage({ key: 'checks', status: 'running', offSteps: off('install') }),
          stage({ key: 'verify', offSteps: off('reproductions') }),
          stage({ key: 'reproductions', status: 'off', offReason: FORK }),
        ])}
      />,
    );
    const row = (key: string) => document.querySelector(`[data-stage="${key}"]`) as HTMLElement;
    expect(row('checks')).toHaveTextContent('Install: off for forks');
    expect(row('verify')).toHaveTextContent('Reproductions: off for forks');
    expect(row('reproductions')).toHaveTextContent('off for forks');

    await user.click(within(row('reproductions')).getByRole('button'));
    expect(row('reproductions')).toHaveTextContent(copy.runs.detail.stageOffForFork);
  });

  test('Run detail of a non-fork round has no off steps', () => {
    render(<StageList detail={runDetail([stage({ key: 'checks' }), stage({ key: 'verify' })])} />);
    expect(screen.queryAllByTestId('off-step')).toHaveLength(0);
  });

  test.each([
    [true, true],
    [false, false],
  ])('the Start review popover notes a read-only review (fork: %s)', async (isFork, shown) => {
    stubFetch({
      '/api/prs/wb/12': aPrView({ isFork }),
      '/api/prs/wb/12/findings': aFindingsResponse(),
    });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const header = (await screen.findByTestId('pr-meta')).closest('header')!;
    await user.click(within(header).getByRole('button', { name: /Start review/ }));
    const dialog = await screen.findByRole('dialog');
    const note = 'Read-only review: no install, reproductions, implementer or push.';
    if (shown) expect(dialog).toHaveTextContent(note);
    else expect(dialog).not.toHaveTextContent(note);
  });
});
