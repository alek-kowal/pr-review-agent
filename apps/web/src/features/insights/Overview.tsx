import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';
import { InsightsFilters } from './InsightsFilters.tsx';
import { overviewQuery } from './queries.ts';
import { DEFAULT_RANGE, type InsightsSearch } from './search.ts';
import type { Lanes, OverviewPr, OverviewResponse } from './types.ts';

const t = copy.insights;

/** Insights → Overview: the five pilot metrics, the ready → merge split and the PR table. */
export function Overview({ search }: { search: InsightsSearch }) {
  const range = search.range ?? DEFAULT_RANGE;
  const query = useQuery(overviewQuery({ range, repo: search.repo, author: search.author }));
  return (
    <div className="flex flex-col gap-4">
      <InsightsFilters
        search={search}
        show={['range', 'author', 'repo']}
        authors={query.data?.authors}
      />
      {query.isPending ? (
        <p className="text-text-3">{t.loading}</p>
      ) : query.isError ? (
        <p role="alert" className="text-bad">
          {t.failed}
        </p>
      ) : query.data.prs.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <p className="font-medium">{t.overview.empty}</p>
          <p className="text-sm text-text-3">{t.overview.emptyHint}</p>
        </div>
      ) : (
        <>
          <MetricTiles data={query.data} />
          <LaneSplit
            lanes={query.data.metrics.readyToMerge.lanes}
            merged={query.data.metrics.readyToMerge.sampleSize}
          />
          <PrTable prs={query.data.prs} />
        </>
      )}
      <NotMeasuredYet />
    </div>
  );
}

function MetricTiles({ data }: { data: OverviewResponse }) {
  const m = data.metrics;
  const o = t.overview.metrics;
  const anyClosed = data.prs.some((pr) => pr.outcome === 'closed');
  const duration = (ms: number | null) => (ms === null ? t.none : t.duration(ms));
  return (
    <ul
      aria-label={t.overview.metricsLabel}
      className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-5"
    >
      <Tile
        label={o.agentWork.label}
        value={duration(m.agentWork.valueMs)}
        median
        sample={m.agentWork}
        closed={anyClosed}
        definition={o.agentWork.definition}
      />
      <Tile
        label={o.readyToMerge.label}
        value={duration(m.readyToMerge.valueMs)}
        median
        sample={m.readyToMerge}
        closed={false}
        definition={o.readyToMerge.definition}
      />
      <Tile
        label={o.cost.label}
        value={m.cost.valueUsd === null ? t.none : t.money(m.cost.valueUsd)}
        median
        sample={m.cost}
        closed={anyClosed}
        definition={o.cost.definition(t.money(m.cost.trialCostUsd), t.money(m.cost.analystCostUsd))}
      />
      <Tile
        label={o.roundsUsedUp.label}
        value={o.roundsUsedUp.value(m.roundsUsedUp.count, m.roundsUsedUp.sampleSize)}
        sample={m.roundsUsedUp}
        closed={anyClosed}
        definition={o.roundsUsedUp.definition(m.roundsUsedUp.overThreeRounds)}
      />
      <Tile
        label={o.changedAfterReady.label}
        value={o.changedAfterReady.value(m.changedAfterReady.count, m.changedAfterReady.sampleSize)}
        sample={m.changedAfterReady}
        closed={false}
        definition={o.changedAfterReady.definition(m.changedAfterReady.ignoredBaseMerges)}
      />
    </ul>
  );
}

function Tile(props: {
  label: string;
  value: string;
  median?: boolean;
  sample: { sampleSize: number; tooFew: boolean };
  /** The sample has closed PRs too (metrics over every finished PR). */
  closed: boolean;
  definition: string;
}) {
  const { sampleSize, tooFew } = props.sample;
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-xs text-text-3">{props.label}</span>
      <span className="font-heading text-xl font-semibold tabular-nums">
        {props.value}
        {props.median && (
          <span className="ml-1.5 text-xs font-normal text-text-3">{t.overview.median}</span>
        )}
      </span>
      <span className="text-xs text-text-2">
        {t.overview.basedOn(sampleSize, props.closed)}
        {tooFew && <span className="text-warn"> · {t.overview.tooFew}</span>}
      </span>
      <span className="text-xs text-text-3">{props.definition}</span>
    </li>
  );
}

const LANES = [
  { key: 'agentsWorking', color: 'bg-brand' },
  { key: 'actionNeeded', color: 'bg-warn-solid' },
  { key: 'readyToMerge', color: 'bg-ok-solid' },
] as const;

function LaneSplit({ lanes, merged }: { lanes: Lanes; merged: number }) {
  const l = t.overview.lanes;
  const total = lanes.agentsWorking + lanes.actionNeeded + lanes.readyToMerge;
  const share = (ms: number) => (total === 0 ? t.none : t.percent(ms / total));
  return (
    <section
      aria-labelledby="insights-lanes"
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider px-4 py-2.5">
        <h2 id="insights-lanes" className="m-0 font-heading text-sm font-semibold">
          {l.title}
        </h2>
        <span className="text-xs text-text-3">{l.sample(merged)}</span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div aria-hidden="true" className="flex h-6 overflow-hidden rounded-md bg-inset">
          {total > 0 &&
            LANES.map(({ key, color }) => (
              <div
                key={key}
                className={color}
                style={{ width: `${(lanes[key] / total) * 100}%` }}
              />
            ))}
        </div>
        <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {LANES.map(({ key, color }) => (
            <div key={key} className="flex items-center gap-2">
              <dt className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-block size-2.5 rounded-sm ${color}`} />
                {l[key]}
              </dt>
              <dd className="m-0 font-medium tabular-nums">
                {share(lanes[key])}{' '}
                <span className="font-normal text-text-3">{t.duration(lanes[key])}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-xs text-text-3">{l.queueNote}</p>
      </div>
    </section>
  );
}

function Fold({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-2">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        {title}
      </summary>
      {children}
    </details>
  );
}

function PrTable({ prs }: { prs: OverviewPr[] }) {
  const c = t.overview.table;
  const cell = 'px-3 py-1.5';
  return (
    <Fold title={c.title(prs.length)}>
      <div className="overflow-x-auto border-t border-divider">
        <table className="w-full text-[13px]">
          <thead className="text-left text-text-3">
            <tr>
              <th className={`${cell} font-medium`}>{c.columns.pullRequest}</th>
              <th className={`${cell} font-medium`}>{c.columns.author}</th>
              <th className={`${cell} text-right font-medium`}>{c.columns.readyToMerge}</th>
              <th className={`${cell} text-right font-medium`}>{c.columns.agentWork}</th>
              <th className={`${cell} text-right font-medium`}>{c.columns.cost}</th>
              <th className={`${cell} text-right font-medium`}>{c.columns.rounds}</th>
              <th className={`${cell} font-medium`}>{c.columns.changedAfterReady}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {prs.map((pr) => (
              <tr key={`${pr.repository}#${pr.number}`}>
                <td className={cell}>
                  <Link
                    to="/pr/$repo/$number"
                    params={{ repo: pr.repository, number: String(pr.number) }}
                    className="font-medium text-text no-underline hover:underline"
                  >
                    {pr.title}
                  </Link>{' '}
                  <span className="font-mono text-text-3">{c.number(pr.number)}</span>
                  <div className="text-xs text-text-3">
                    {pr.repository} · {pr.outcome === 'merged' ? c.merged : c.closed}
                  </div>
                </td>
                <td className={cell}>{pr.author}</td>
                <td className={`${cell} text-right tabular-nums`}>
                  {pr.readyToMergeMs === null ? t.none : t.duration(pr.readyToMergeMs)}
                </td>
                <td className={`${cell} text-right tabular-nums`}>{t.duration(pr.agentWorkMs)}</td>
                <td className={`${cell} text-right tabular-nums`}>{t.money(pr.costUsd)}</td>
                <td className={`${cell} text-right tabular-nums`}>{pr.rounds}</td>
                <td className={cell}>
                  {pr.changedAfterReady === null ? t.none : pr.changedAfterReady ? c.yes : c.no}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Fold>
  );
}

function NotMeasuredYet() {
  const n = t.overview.notMeasured;
  return (
    <Fold title={n.title}>
      <div className="border-t border-divider px-4 py-3 text-sm">
        <p className="m-0 text-text-2">{n.intro}</p>
        <ul className="mt-2 mb-0 pl-5">
          {n.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </Fold>
  );
}
