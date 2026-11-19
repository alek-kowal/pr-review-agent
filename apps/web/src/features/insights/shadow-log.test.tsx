// S-19-T9: Insights → Trust ladder shows each repository's "Level 5 shadow log": what level 5
// would have done per PR over the last 14 days, or "Not enough data yet" below 5 PRs.
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import type { TrustResponse } from './types.ts';

afterEach(restoreFetch);

type Row = TrustResponse['repositories'][number];
type ShadowPr = Row['shadow']['prs'][number];

const repositories = {
  repositories: [
    { slug: 'wb', name: 'workflowbuilder', githubFullName: 'acme/wb' },
    { slug: 'tpl', name: 'templates', githubFullName: 'acme/tpl' },
  ],
};

const at = '2026-11-18T10:00:00.000Z';
const met = { code: 'autofix_conditions_met', params: { count: 2 } };
const pr = (number: number, over: Partial<ShadowPr> = {}): ShadowPr => ({
  number,
  decision: 'would_push',
  reason: met,
  fixed: 2,
  total: 2,
  at,
  ...over,
});

const row = (over: Partial<Row>): Row => ({
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
  ...over,
});

const wb = row({
  shadow: {
    days: 14,
    eligible: 5,
    needed: 5,
    wouldFix: 3,
    prs: [
      pr(265),
      pr(270, { decision: 'would_start', fixed: 1, total: 1 }),
      pr(263),
      pr(272, {
        decision: 'would_wait',
        reason: { code: 'open_questions', params: { count: 2 } },
        fixed: 0,
      }),
      pr(264, {
        decision: 'would_wait',
        reason: {
          code: 'patch_touches_sensitive',
          params: { path: 'infra/deploy.yml', pattern: 'infra/**' },
        },
      }),
    ],
  },
});
const tpl = row({
  repositoryId: 2,
  repository: 'tpl',
  level: 4,
  shadow: { days: 14, eligible: 2, needed: 5, wouldFix: 1, prs: [pr(12), pr(13)] },
});

const t = copy.insights.trust.shadow;

test('with 5 PRs or more: the summary, the ⓘ and one row per PR linked to it', async () => {
  stubFetch({
    '/api/insights/trust': { repositories: [wb, tpl] },
    '/api/repositories': repositories,
  });
  renderApp('/insights/trust');

  const card = await screen.findByRole('region', { name: 'wb' });
  const log = within(card).getByRole('region', { name: t.title });
  expect(log).toHaveTextContent('Level 5 would have fixed 3 of 5 PRs');
  expect(log).toHaveTextContent('last 14 days');
  expect(within(log).getByTitle(t.nothingPushed)).toBeInTheDocument();

  const rows = within(within(log).getByRole('list', { name: t.listLabel })).getAllByRole(
    'listitem',
  );
  expect(rows.map((li) => li.textContent)).toEqual([
    '#265would have fixed 2 of 2 and pushed',
    '#270would have fixed 1 of 1',
    '#263would have fixed 2 of 2 and pushed',
    '#272would have waited: 2 questions to answer',
    '#264would have waited: patch touches a sensitive file',
  ]);
  expect(within(rows[0]!).getByRole('link', { name: '#265' })).toHaveAttribute(
    'href',
    '/pr/wb/265',
  );
});

test('below 5 PRs: "Not enough data yet (n of 5 PRs)" and no rows', async () => {
  stubFetch({
    '/api/insights/trust': { repositories: [wb, tpl] },
    '/api/repositories': repositories,
  });
  renderApp('/insights/trust');

  const card = await screen.findByRole('region', { name: 'tpl' });
  const log = within(card).getByRole('region', { name: t.title });
  expect(log).toHaveTextContent('Not enough data yet (2 of 5 PRs)');
  expect(within(log).getByTitle(t.startsAtLevel3)).toBeInTheDocument();
  expect(within(log).queryByRole('list')).toBeNull();
  expect(log).not.toHaveTextContent('would have');
});
