// S-22-T8: "Try on a PR…", Settings → Experiments and a trial's Compare page.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type {
  InstructionDetailResponse,
  InstructionVersionView,
  TrialDetailResponse,
  TrialFindingView,
  TrialSummaryView,
} from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aBoardCard, anEmptyBoard } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.trials;

const version = (patch: Partial<InstructionVersionView>): InstructionVersionView => ({
  id: 70,
  version: 1,
  note: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  activatedAt: '2026-11-01T10:00:00.000Z',
  status: 'active',
  content: 'Check types.\nCheck tests.\n',
  author: 'bot',
  authorName: null,
  signerName: null,
  runCount: 0,
  runs: [],
  ...patch,
});

const v1 = version({});
const v2Draft = version({
  id: 71,
  version: 2,
  status: 'draft',
  content: 'Check types.\nCheck public API names.\n',
  note: 'Name the API rule',
  author: 'hand',
  activatedAt: null,
});

const editorDetail: InstructionDetailResponse = {
  file: {
    id: 7,
    scope: 'repository',
    repository: { id: 1, slug: 'workflowbuilder' },
    level: null,
    fileKey: 'review-rules.md',
  },
  versions: [v2Draft, v1],
};

const finding = (patch: Partial<TrialFindingView>): TrialFindingView => ({
  id: 1,
  severity: 'worth_fixing',
  title: 'Missing null check',
  file: 'src/graph.ts',
  line: 10,
  verdict: 'confirmed',
  ...patch,
});

const summary: TrialSummaryView = {
  id: 3,
  pr: { repo: 'workflowbuilder', number: 272, title: 'Group nodes' },
  draft: { id: 71, fileId: 7, fileKey: 'review-rules.md', version: 2, status: 'draft' },
  status: 'completed',
  startedBy: 'hand',
  headSha: 'abc1234def',
  createdAt: '2026-11-19T10:00:00.000Z',
};

const trial: TrialDetailResponse = {
  trial: {
    ...summary,
    runs: {
      a: { id: 51, status: 'completed', costUsd: 0.42 },
      b: { id: 52, status: 'completed', costUsd: 0.57 },
    },
    compare: {
      onlyA: [finding({ id: 1, title: 'Unused import', file: 'src/a.ts', line: 3 })],
      onlyB: [finding({ id: 2, title: 'Public API name changed', file: 'src/api.ts', line: 8 })],
      both: [
        {
          a: finding({ id: 3, title: 'Missing null check' }),
          b: finding({ id: 4, title: 'Missing null check' }),
        },
      ],
    },
    diff: {
      fileKey: 'review-rules.md',
      before: { version: 1, content: v1.content },
      after: { version: 2, content: v2Draft.content },
    },
  },
};

beforeEach(() => window.localStorage.clear());
afterEach(restoreFetch);

describe('Try on a PR…', () => {
  test('starts a trial of the draft for the picked PR and opens its Compare page', async () => {
    const pr272 = aBoardCard({
      repository: { slug: 'workflowbuilder' },
      number: 272,
      title: 'Group nodes',
    });
    const otherRepo = aBoardCard({ repository: { slug: 'other' }, number: 9, title: 'Elsewhere' });
    const { calls } = stubFetch({
      '/api/instructions/7': editorDetail,
      '/api/board': anEmptyBoard({
        lanes: { ...anEmptyBoard().lanes, action_needed: { cards: [pr272, otherRepo] } },
      }),
      'POST /api/trials': { status: 201, body: trial },
      '/api/trials/3': trial,
      '/api/trials': { trials: [summary] },
    });
    renderApp('/settings/instructions/7');

    await userEvent.click(
      await screen.findByRole('button', { name: copy.instructions.editor.tryOnPr }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(t.tryDialog.title('review-rules.md', 2));

    // Starting with no PR picked asks for one and sends nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: t.tryDialog.start }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t.tryDialog.prRequired);

    await userEvent.click(within(dialog).getByRole('combobox', { name: t.tryDialog.prLabel }));
    // A repository file offers only its repository's PRs.
    expect(screen.queryByRole('option', { name: /Elsewhere/ })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: /#272 Group nodes/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: t.tryDialog.start }));

    expect(await screen.findByRole('heading', { name: t.compare.title(3) })).toBeInTheDocument();
    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/api/trials');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      pr: { repo: 'workflowbuilder', number: 272 },
      instructionDraft: 71,
    });
    expect(posts[0]!.body).not.toHaveProperty('signedBy');
  });
});

describe('Settings → Experiments', () => {
  test('lists trials, each linking to its Compare page', async () => {
    stubFetch({ '/api/trials': { trials: [summary] } });
    renderApp('/settings/experiments');

    const table = await screen.findByRole('table', { name: t.experiments.tableLabel });
    const row = within(table).getByRole('row', { name: /Trial 3/ });
    expect(row).toHaveTextContent('workflowbuilder #272');
    expect(row).toHaveTextContent('review-rules.md v2');
    expect(row).toHaveTextContent(t.status.completed!);
    expect(row).toHaveTextContent(t.experiments.startedByHand);
    expect(within(row).getByRole('link', { name: t.experiments.trial(3) })).toHaveAttribute(
      'href',
      '/settings/experiments/3',
    );
  });
});

describe('the Compare page', () => {
  test('renders the three buckets, both costs and the instruction diff', async () => {
    stubFetch({ '/api/trials/3': trial });
    renderApp('/settings/experiments/3');

    const onlyA = await screen.findByRole('region', { name: t.compare.buckets.onlyA });
    expect(onlyA).toHaveTextContent('Unused import');
    expect(onlyA).toHaveTextContent('src/a.ts:3');
    const onlyB = screen.getByRole('region', { name: t.compare.buckets.onlyB });
    expect(onlyB).toHaveTextContent('Public API name changed');
    const both = screen.getByRole('region', { name: t.compare.buckets.both });
    expect(both).toHaveTextContent('Missing null check');
    expect(both).not.toHaveTextContent('Unused import');

    const costA = screen.getByRole('region', { name: t.compare.costLabel(t.compare.sides.a) });
    expect(costA).toHaveTextContent('$0.42');
    expect(within(costA).getByRole('link', { name: t.compare.runLink })).toHaveAttribute(
      'href',
      '/runs/51',
    );
    const costB = screen.getByRole('region', { name: t.compare.costLabel(t.compare.sides.b) });
    expect(costB).toHaveTextContent('$0.57');

    const diff = screen.getByRole('region', {
      name: t.compare.diffLabel('review-rules.md', 1, 2),
    });
    expect(diff.querySelector('ins')).toHaveTextContent('Check public API names.');
    expect(diff.querySelector('del')).toHaveTextContent('Check tests.');
  });

  test('"Go to activate version 2" opens the editor on the draft', async () => {
    stubFetch({ '/api/trials/3': trial, '/api/instructions/7': editorDetail });
    renderApp('/settings/experiments/3');

    await userEvent.click(await screen.findByRole('link', { name: t.compare.activate(2) }));

    expect(
      await screen.findByRole('button', { name: copy.instructions.editor.activate(2) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: copy.instructions.editor.contentLabel }),
    ).toHaveValue(v2Draft.content);
  });

  test('a draft that was activated since shows its status instead of the link', async () => {
    stubFetch({
      '/api/trials/3': {
        trial: { ...trial.trial, draft: { ...trial.trial.draft, status: 'active' } },
      },
    });
    renderApp('/settings/experiments/3');

    expect(await screen.findByText(t.compare.noLongerDraft(2, 'active'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: t.compare.activate(2) })).not.toBeInTheDocument();
  });
});
