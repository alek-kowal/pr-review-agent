// S-22-T10: Settings → Pipeline, the read-only diagram and a stage's Sheet.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { PipelineResponse, PipelineStageView } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.pipeline;

const stage = (patch: Partial<PipelineStageView> & Pick<PipelineStageView, 'key'>) =>
  ({
    role: null,
    model: null,
    tools: [],
    integrations: [],
    instructions: [],
    output: { schema: 'Output', fields: ['a'] },
    timeoutMinutes: 30,
    attempts: 1,
    repairs: 0,
    onFrom: 1,
    ...patch,
  }) satisfies PipelineStageView;

const pipeline: PipelineResponse = {
  stages: [
    stage({ key: 'checks', onFrom: 2, integrations: ['GitHubGateway'] }),
    stage({
      key: 'review',
      role: 'reviewer',
      model: { model: 'claude-fable-5-2', source: 'settings', level: null },
      tools: ['Read', 'Grep', 'Glob'],
      instructions: [
        { fileKey: 'prompt-reviewer.md', fileId: null, version: null },
        { fileKey: 'review-rules.md', fileId: 4, version: 2 },
      ],
      output: { schema: 'ReviewOutput', fields: ['summary', 'findings'] },
    }),
    stage({ key: 'verify', role: 'verifier', onFrom: 3, repairs: 1 }),
    stage({ key: 'implement', role: 'implementer', onFrom: 4 }),
  ],
};

beforeEach(() => window.localStorage.clear());
afterEach(restoreFetch);

test('one node per stage, labelled with its level, none of them draggable', async () => {
  stubFetch({ '/api/pipeline': pipeline });
  const { container } = renderApp('/settings/pipeline');

  const diagram = await screen.findByRole('group', { name: t.diagramLabel });
  expect(within(diagram).getByRole('button', { name: t.node('Review', 1) })).toBeInTheDocument();
  expect(within(diagram).getByRole('button', { name: t.node('Verify', 3) })).toBeInTheDocument();
  const nodes = container.querySelectorAll('.react-flow__node');
  expect(nodes).toHaveLength(4);
  for (const node of nodes) {
    expect(node).not.toHaveClass('draggable');
    expect(node).not.toHaveClass('selectable');
    expect(node).not.toHaveClass('connectable');
  }
  expect(container.querySelector('.react-flow__handle.connectable')).toBeNull();
});

test('Enter on the Review node opens the Sheet with its model, tools and instructions', async () => {
  stubFetch({ '/api/pipeline': pipeline });
  renderApp('/settings/pipeline');

  const review = await screen.findByRole('button', { name: t.node('Review', 1) });
  review.focus();
  await userEvent.keyboard('{Enter}');

  const sheet = await screen.findByRole('dialog', { name: 'Review' });
  expect(sheet).toHaveTextContent('claude-fable-5-2');
  expect(sheet).toHaveTextContent(t.modelSource.settings);
  expect(sheet).toHaveTextContent('Read, Grep, Glob');
  expect(within(sheet).getByRole('link', { name: 'review-rules.md v2' })).toHaveAttribute(
    'href',
    '/settings/instructions/4',
  );
  expect(sheet).toHaveTextContent(t.sheet.fileVersion('prompt-reviewer.md', null));
  expect(sheet).toHaveTextContent('ReviewOutput: summary, findings');
  expect(sheet).toHaveTextContent(t.sheet.level(1));

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a code stage has no model and lists the services it calls', async () => {
  stubFetch({ '/api/pipeline': pipeline });
  renderApp('/settings/pipeline');

  await userEvent.click(await screen.findByRole('button', { name: t.node('Checks', 2) }));
  const sheet = await screen.findByRole('dialog', { name: 'Checks' });
  expect(sheet).toHaveTextContent(t.noModel);
  expect(sheet).toHaveTextContent('GitHubGateway');
  expect(sheet).toHaveTextContent(t.sheet.noInstructions);
});
