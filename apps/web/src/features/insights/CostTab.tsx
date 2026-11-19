import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart.tsx';
import { copy } from '@/copy/index.ts';
import { InsightsFilters } from './InsightsFilters.tsx';
import { Bars, Card, Stat } from './parts.tsx';
import { costQuery } from './queries.ts';
import { DEFAULT_RANGE, type InsightsSearch } from './search.ts';
import type { CostResponse } from './types.ts';

const t = copy.insights;

/** Insights → Cost: real spend on PR work, with trials and the analyst kept apart. */
export function CostTab({ search }: { search: InsightsSearch }) {
  const range = search.range ?? DEFAULT_RANGE;
  const query = useQuery(costQuery({ range, repo: search.repo }));
  return (
    <div className="flex flex-col gap-4">
      <InsightsFilters search={search} show={['range', 'repo']} />
      <div data-work-start className="flex flex-col gap-4">
        {query.isPending ? (
          <p className="text-text-3">{t.loading}</p>
        ) : query.isError ? (
          <p role="alert" className="text-bad">
            {t.failed}
          </p>
        ) : (
          <CostView data={query.data} repo={search.repo} />
        )}
      </div>
    </div>
  );
}

function CostView({ data, repo }: { data: CostResponse; repo: string | undefined }) {
  const c = t.cost;
  const { today } = data;
  return (
    <>
      <ul
        aria-label={c.statsLabel}
        className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3"
      >
        <Stat
          label={c.today}
          value={t.money(today.spentUsd)}
          sub={today.budgetUsd === null ? c.noBudget : c.ofBudget(t.money(today.budgetUsd))}
        />
        <Stat
          label={c.rangeTotal(data.range)}
          value={t.money(data.totalUsd)}
          sub={c.rangeTotalSub(repo)}
        />
        <Stat
          label={c.averageRound}
          value={data.averageRoundUsd === null ? t.none : t.money(data.averageRoundUsd)}
          sub={c.averageRoundSub}
        />
      </ul>
      <Card id="insights-by-day" title={c.byDay}>
        <div className="p-4">
          <DailyChart data={data} />
        </div>
      </Card>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card id="insights-by-repo" title={c.byRepository}>
          <div className="px-4 py-3">
            <Bars
              label={c.byRepository}
              rows={data.byRepository.map((row) => ({ name: row.repository, usd: row.costUsd }))}
            />
          </div>
        </Card>
        <Card id="insights-by-role" title={c.byRole}>
          <div className="px-4 py-3">
            <Bars
              label={c.byRole}
              rows={data.byRole.map((row) => ({
                name: c.roles[row.role] ?? row.role,
                usd: row.costUsd,
              }))}
            />
          </div>
        </Card>
        <Card id="insights-by-level" title={c.byLevel}>
          <div className="px-4 py-3">
            <Bars
              label={c.byLevel}
              rows={data.byLevel.map((row) => ({ name: t.level(row.level), usd: row.costUsd }))}
            />
          </div>
        </Card>
      </div>
      <Card id="insights-separate" title={c.separate}>
        <div className="flex flex-col gap-2 px-4 py-3">
          <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-text-2">{c.trials}</dt>
              <dd className="m-0 font-medium tabular-nums">{t.money(data.separate.trial)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-text-2">{c.analyst}</dt>
              <dd className="m-0 font-medium tabular-nums">{t.money(data.separate.analyst)}</dd>
            </div>
          </dl>
          <p className="m-0 text-xs text-text-3">{c.separateHint}</p>
        </div>
      </Card>
    </>
  );
}

const chartConfig = {
  costUsd: { label: copy.insights.cost.spent, color: 'var(--brand)' },
} satisfies ChartConfig;

/** Spend per UTC day: the bar chart, and the same numbers as a table for screen readers. */
function DailyChart({ data }: { data: CostResponse }) {
  const c = t.cost;
  const label = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <>
      <ChartContainer
        config={chartConfig}
        role="img"
        aria-label={c.byDayChart(data.range)}
        className="aspect-auto h-56 w-full"
      >
        <BarChart data={data.byDay} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickFormatter={label}
            minTickGap={16}
          />
          <YAxis
            width={48}
            tickLine={false}
            axisLine={false}
            tickFormatter={(usd: number) => t.tick(usd)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(day) => label(String(day))}
                formatter={(value) => t.money(Number(value))}
              />
            }
          />
          <Bar dataKey="costUsd" fill="var(--color-costUsd)" radius={3} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>{c.byDayChart(data.range)}</caption>
        <thead>
          <tr>
            <th>{c.day}</th>
            <th>{c.spent}</th>
          </tr>
        </thead>
        <tbody>
          {data.byDay.map((row) => (
            <tr key={row.day}>
              <td>{label(row.day)}</td>
              <td>{t.money(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
