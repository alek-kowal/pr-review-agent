import { screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import type { TrustResponse } from './types.ts';

afterEach(restoreFetch);

const repositories = {
  repositories: [
    { slug: 'wb', name: 'workflowbuilder', githubFullName: 'acme/wb' },
    { slug: 'tpl', name: 'templates', githubFullName: 'acme/tpl' },
  ],
};

const wb: TrustResponse['repositories'][number] = {
  repositoryId: 1,
  repository: 'wb',
  level: 3,
  since: '2026-11-05T10:00:00.000Z',
  days: 14,
  rounds: 19,
  findings: 64,
  decided: 50,
  unchecked: false,
  tooFew: false,
  confirmedRate: 0.72,
  refutedRate: 0.11,
  implementShare: 0.58,
  shadow: { days: 14, eligible: 0, needed: 5, wouldFix: 0, prs: [] },
};
const tpl: TrustResponse['repositories'][number] = {
  repositoryId: 2,
  repository: 'tpl',
  level: 1,
  since: '2026-11-08T10:00:00.000Z',
  days: 11,
  rounds: 2,
  findings: 3,
  decided: 3,
  unchecked: true,
  tooFew: true,
  confirmedRate: null,
  refutedRate: null,
  implementShare: null,
  shadow: { days: 14, eligible: 0, needed: 5, wouldFix: 0, prs: [] },
};

test('one card per repository, the current level highlighted, too few below 5 findings', async () => {
  stubFetch({
    '/api/insights/trust': { repositories: [wb, tpl] },
    '/api/repositories': repositories,
  });
  renderApp('/insights/trust');

  const wbCard = await screen.findByRole('region', { name: 'wb' });
  const tplCard = screen.getByRole('region', { name: 'tpl' });
  expect(screen.getAllByRole('list', { name: copy.insights.trust.ladderLabel })).toHaveLength(2);

  const ladder = within(wbCard).getByRole('list', { name: copy.insights.trust.ladderLabel });
  const steps = within(ladder).getAllByRole('listitem');
  expect(steps).toHaveLength(6);
  expect(steps.filter((step) => step.getAttribute('aria-current') === 'step')).toEqual([steps[2]]);
  expect(steps[2]).toHaveTextContent('3 · Verified');

  expect(wbCard).toHaveTextContent(
    'Level 3 for 14 days: 58% of decided findings were Implement, 72% confirmed, 11% refuted. Based on 64 findings in 19 rounds.',
  );
  expect(
    within(wbCard).getByRole('link', { name: copy.insights.trust.changeLevel }),
  ).toHaveAttribute('href', '/settings/repositories/1');

  expect(tplCard).toHaveTextContent(
    'Level 1 for 11 days: Too few findings for rates yet (3 of 5). Based on 3 findings in 2 rounds.',
  );
  expect(document.body.textContent).not.toMatch(/[+-]\d+%|better|worse|trend/i);
});

test('the repository filter applies', async () => {
  const { calls } = stubFetch({
    '/api/insights/trust?repo=tpl': { repositories: [tpl] },
    '/api/repositories': repositories,
  });
  renderApp('/insights/trust?repo=tpl');
  await screen.findByRole('region', { name: 'tpl' });
  expect(screen.queryByRole('region', { name: 'wb' })).toBeNull();
  expect(calls.map((call) => call.path)).toContain('/api/insights/trust?repo=tpl');
});
