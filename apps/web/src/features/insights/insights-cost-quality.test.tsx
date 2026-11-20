import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '@/copy/index.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import type { CostResponse, QualityRates, QualityResponse } from './types.ts';

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

const repositories = {
  repositories: [{ slug: 'wb', name: 'workflowbuilder', githubFullName: 'acme/wb' }],
};

const cost: CostResponse = {
  range: 14,
  since: '2026-11-06T00:00:00.000Z',
  totalUsd: 12.5,
  byDay: Array.from({ length: 14 }, (_, i) => ({
    day: `2026-11-${String(6 + i).padStart(2, '0')}`,
    costUsd: i === 13 ? 4.25 : i % 2 ? 1 : 0,
  })),
  byRepository: [{ repository: 'wb', costUsd: 12.5 }],
  byRole: [
    { role: 'reviewer', costUsd: 10 },
    { role: 'verifier', costUsd: 2.5 },
  ],
  byLevel: [
    { level: 1, costUsd: 7 },
    { level: 3, costUsd: 5.5 },
  ],
  separate: { trial: 3.2, analyst: 0.75 },
  today: { spentUsd: 4.25, budgetUsd: 20 },
  averageRoundUsd: 1.36,
};

test('Cost: the chart renders from the API data; trials and the analyst stay apart', async () => {
  // jsdom lays nothing out; the chart needs a size to draw its bars.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ width: 800, height: 224 }),
  );
  stubFetch({ '/api/insights/cost?range=14': cost, '/api/repositories': repositories });
  renderApp('/insights/cost?range=14');

  const chart = await screen.findByRole('img', { name: 'Daily spend for the last 14 days' });
  // One bar per day with spend (zero days draw none).
  const spendDays = cost.byDay.filter((d) => d.costUsd > 0).length;
  expect(chart.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(spendDays);
  // The same numbers as a table beside the chart, one row per day.
  const table = screen.getByRole('table', { name: 'Daily spend for the last 14 days' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(14);
  expect(rows[13]).toHaveTextContent('19 Nov$4.25');

  const stats = screen.getByRole('list', { name: copy.insights.cost.statsLabel });
  expect(stats).toHaveTextContent('Spent today$4.25of $20.00 daily budget');
  expect(stats).toHaveTextContent('Last 14 days$12.50');
  expect(stats).toHaveTextContent('Average round$1.36');
  expect(screen.getByRole('list', { name: copy.insights.cost.byRole })).toHaveTextContent(
    'Reviewer$10.00Verifier$2.50',
  );
  expect(screen.getByRole('list', { name: copy.insights.cost.byLevel })).toHaveTextContent(
    '1 · Diff only$7.003 · Verified$5.50',
  );

  const separate = screen.getByRole('region', { name: copy.insights.cost.separate });
  expect(separate).toHaveTextContent('Trials$3.20');
  expect(separate).toHaveTextContent('Analyst$0.75');
  // Neither is part of the PR work total.
  expect(stats).not.toHaveTextContent('$3.20');
  expect(document.body.textContent).not.toMatch(/[+-]\d+%|better|worse|trend/i);
});

const rates = (patch: Partial<QualityRates>): QualityRates => ({
  findings: 10,
  decided: 8,
  unchecked: false,
  tooFew: false,
  confirmedRate: 0.7,
  refutedRate: 0.1,
  implementShare: 0.5,
  ...patch,
});

const quality: QualityResponse = {
  range: 30,
  since: '2026-10-20T10:00:00.000Z',
  levels: [
    {
      level: 1,
      rounds: 12,
      averageRoundUsd: 1.15,
      ...rates({ unchecked: true, confirmedRate: null, refutedRate: null, implementShare: 0.31 }),
    },
    {
      level: 2,
      rounds: 3,
      averageRoundUsd: 1.4,
      ...rates({ unchecked: true, confirmedRate: null, refutedRate: null, implementShare: 0.36 }),
    },
    {
      level: 3,
      rounds: 6,
      averageRoundUsd: 1.51,
      ...rates({ confirmedRate: 0.72, refutedRate: 0.11 }),
    },
    {
      level: 4,
      rounds: 1,
      averageRoundUsd: 1.53,
      ...rates({
        findings: 4,
        tooFew: true,
        confirmedRate: null,
        refutedRate: null,
        implementShare: null,
      }),
    },
    { level: 5, rounds: 0, averageRoundUsd: null, ...rates({ findings: 0, tooFew: true }) },
    { level: 6, rounds: 0, averageRoundUsd: null, ...rates({ findings: 0, tooFew: true }) },
  ],
  versions: [
    {
      instruction: {
        id: 3,
        scope: 'global',
        repository: null,
        fileKey: 'review-rules.md',
        kind: 'instruction',
        version: 3,
        active: true,
      },
      runs: 7,
      averageCostUsd: 1.38,
      ...rates({ confirmedRate: 0.74, implementShare: 0.61 }),
    },
    {
      instruction: {
        id: 9,
        scope: 'repository',
        repository: 'wb',
        fileKey: 'feature-map/canvas.md',
        kind: 'document',
        version: 1,
        active: true,
      },
      runs: 7,
      averageCostUsd: 1.38,
      ...rates({ confirmedRate: 0.74, implementShare: 0.61 }),
    },
    {
      instruction: null,
      runs: 2,
      averageCostUsd: 0.4,
      ...rates({ findings: 3, tooFew: true, confirmedRate: null, implementShare: null }),
    },
  ],
};

test('Quality: levels 1–2 say Unchecked and rows below 5 findings say too few', async () => {
  stubFetch({ '/api/insights/quality?range=30': quality, '/api/repositories': repositories });
  renderApp('/insights/quality');

  const levels = await screen.findByRole('table', { name: copy.insights.quality.perLevel });
  const row = (name: string) => within(levels).getByRole('row', { name: new RegExp(`^${name}`) });
  for (const name of ['1 · Diff only', '2 · With context']) {
    expect(within(row(name)).getAllByText(copy.insights.unchecked)).toHaveLength(2);
  }
  expect(row('1 · Diff only')).toHaveTextContent('31%');
  expect(row('3 · Verified')).toHaveTextContent('72%11%50%$1.51');
  expect(row('4 · Fix on request')).toHaveTextContent('Too few findings (4 of 5)');
  expect(row('4 · Fix on request')).not.toHaveTextContent('%');

  // KINDS: instructions and documents each have their own table.
  const tableOf = (kind: string) =>
    screen.getByRole('table', {
      name: copy.insights.quality.perVersionOf(copy.instructions.kindTitles[kind]!),
    });
  const documents = tableOf('document');
  expect(within(documents).getByRole('row', { name: /^feature-map\/canvas\.md/ })).toBeVisible();
  expect(within(documents).queryByText('review-rules.md')).toBeNull();
  const versions = tableOf('instruction');
  expect(within(versions).queryByText(/feature-map/)).toBeNull();
  expect(within(versions).getByRole('row', { name: /^review-rules\.md/ })).toHaveTextContent(
    'v3 · active',
  );
  expect(within(versions).getByRole('row', { name: /^No version recorded/ })).toHaveTextContent(
    'Too few findings (3 of 5)',
  );
});
