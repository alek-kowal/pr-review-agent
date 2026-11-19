import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { FindingView, RoundView } from '@/lib/api-types.ts';
import { aFinding, aFindingsResponse, aPrView, aRound } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

function openFindings(
  findings: FindingView[],
  options: { notChecked?: string[]; round?: RoundView | null; findingsRound?: null } = {},
) {
  stubFetch({
    '/api/prs/wb/12': aPrView({ round: options.round }),
    '/api/prs/wb/12/findings': aFindingsResponse({
      findings,
      notChecked: options.notChecked ?? [],
      ...(options.findingsRound === null ? { round: null } : {}),
    }),
  });
  return renderApp('/pr/wb/12?tab=findings');
}

const groupNames = () =>
  within(screen.getByTestId('findings-tab'))
    .getAllByRole('region')
    .map((section) => section.getAttribute('aria-label'));

test('groups findings by severity in order: Blocking, Worth fixing, Nits', async () => {
  openFindings([
    aFinding({ severity: 'nit', title: 'Rename a variable' }),
    aFinding({ severity: 'worth_fixing', title: 'Missing null check' }),
    aFinding({ severity: 'blocking', title: 'Grouping drops edges' }),
    aFinding({ severity: 'blocking', title: 'Undo breaks after grouping' }),
  ]);

  await screen.findByTestId('findings-tab');
  expect(groupNames()).toEqual(['Blocking', 'Worth fixing', 'Nits']);
  const blocking = screen.getByRole('region', { name: 'Blocking' });
  expect(within(blocking).getAllByRole('article')).toHaveLength(2);
  expect(within(blocking).getByRole('heading')).toHaveTextContent('Blocking2');
});

test('a finding shows file and line and its verdict, and opens to scenario and suggestion', async () => {
  const user = userEvent.setup();
  openFindings([
    aFinding({
      severity: 'blocking',
      title: 'Grouping drops edges',
      file: 'src/nodes/group.ts',
      line: 42,
      scenario: 'Group two nodes joined by an edge: the edge disappears.',
      suggestion: 'Copy the edges into the group before removing the nodes.',
      evidence: [{ file: 'src/nodes/group.ts', line: 40, quote: 'nodes.forEach(remove)' }],
    }),
  ]);

  const finding = await screen.findByRole('article', { name: 'Blocking: Grouping drops edges' });
  expect(finding).toHaveTextContent('src/nodes/group.ts:42');
  expect(within(finding).getByTestId('verdict')).toHaveTextContent('Unchecked (level 1)');
  expect(within(finding).queryByText(/edge disappears/)).toBeNull();

  await user.click(within(finding).getByRole('button', { expanded: false }));

  expect(within(finding).getByRole('heading', { name: copy.findings.scenario })).toBeVisible();
  expect(within(finding).getByText(/the edge disappears/)).toBeVisible();
  expect(within(finding).getByRole('heading', { name: copy.findings.suggestion })).toBeVisible();
  expect(within(finding).getByText(/Copy the edges into the group/)).toBeVisible();
  expect(within(finding).getByText('nodes.forEach(remove)')).toBeVisible();
  expect(finding).toHaveTextContent('src/nodes/group.ts:40');
});

test('a finding without a line shows the file only', async () => {
  openFindings([aFinding({ title: 'No tests for grouping', file: 'src/nodes/', line: null })]);

  const finding = await screen.findByRole('article', { name: /No tests for grouping/ });
  expect(within(finding).getByText('src/nodes/')).toBeInTheDocument();
});

test('no filter at 6 findings', async () => {
  openFindings(Array.from({ length: 6 }, () => aFinding()));

  await screen.findByTestId('findings-tab');
  expect(screen.getAllByRole('article')).toHaveLength(6);
  expect(screen.queryByRole('group', { name: copy.findings.filterLabel })).toBeNull();
});

test('a filter at 7 findings; To decide leaves nits out', async () => {
  const user = userEvent.setup();
  openFindings([
    ...Array.from({ length: 5 }, () => aFinding({ severity: 'worth_fixing' })),
    aFinding({ severity: 'nit', title: 'A nit' }),
    aFinding({ severity: 'blocking', title: 'Refuted one', verdict: 'refuted' }),
  ]);

  const filter = await screen.findByRole('group', { name: copy.findings.filterLabel });
  expect(screen.getAllByRole('article')).toHaveLength(7);

  await user.click(within(filter).getByRole('button', { name: copy.findings.filters.todo }));

  expect(screen.getAllByRole('article')).toHaveLength(5);
  expect(screen.queryByRole('article', { name: /A nit/ })).toBeNull();

  await user.click(within(filter).getByRole('button', { name: copy.findings.filters.done }));
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByText(copy.findings.noMatch)).toBeInTheDocument();
});

test('lists what the round did not check below the findings', async () => {
  openFindings([aFinding()], { notChecked: ['The e2e tests', 'Styles'] });

  const section = await screen.findByRole('region', { name: copy.findings.notChecked });
  expect(
    within(section)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['The e2e tests', 'Styles']);
  expect(groupNames().at(-1)).toBe(copy.findings.notChecked);
});

test('a failed round shows its line with the copy for its error code', async () => {
  openFindings([], {
    round: aRound({
      status: 'failed',
      error: { stage: 'review', code: 'model_access_not_configured' },
    }),
    findingsRound: null,
  });

  expect(await screen.findByTestId('round-failed')).toHaveTextContent(
    'Round 1 failed at Review: model access is not configured',
  );
});

test('an unexpected stage error has its own copy, not the raw code', async () => {
  openFindings([], {
    round: aRound({ status: 'failed', error: { stage: 'review', code: 'stage_error' } }),
    findingsRound: null,
  });

  expect(await screen.findByTestId('round-failed')).toHaveTextContent(
    'Round 1 failed at Review: an unexpected error stopped it',
  );
});

test('a PR with no round yet says so', async () => {
  openFindings([], { round: null, findingsRound: null });

  expect(await screen.findByText(copy.findings.empty.none)).toBeInTheDocument();
});
