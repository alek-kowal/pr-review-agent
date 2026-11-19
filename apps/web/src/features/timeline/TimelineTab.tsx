import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState } from 'react';
import { copy } from '@/copy/index.ts';
import { dateTime, duration, money } from '@/copy/format.ts';
import { timelineQuery } from '@/features/pr/queries.ts';
import type { PrTabProps } from '@/features/pr/tabs.ts';
import { RunDetailsLink } from '@/features/runs/RunDetailsLink.tsx';
import { ApiError } from '@/lib/api.ts';
import type { TimelineEntryView, TimelineResponse } from '@/lib/api-types.ts';
import { errorText, reasonText, stageName } from '@/lib/reasons.ts';

type Filter = keyof typeof copy.timeline.filters;
const FILTERS = Object.keys(copy.timeline.filters) as Filter[];

const matches = (entry: TimelineEntryView, filter: Filter) =>
  filter === 'all' || (filter === 'bot' ? entry.actor.kind === 'bot' : entry.actor.kind !== 'bot');

/** Who acted: the signer's name, PR Review Agent, or "By hand". */
export function actorText(entry: Pick<TimelineEntryView, 'actor' | 'memberName'>): string {
  const t = copy.timeline.actor;
  if (entry.actor.kind === 'bot') return t.bot;
  if (entry.actor.kind === 'hand') return t.hand;
  return entry.memberName ?? t.someone;
}

const entryText = (entry: TimelineEntryView): string =>
  copy.timeline.entries[entry.kind]?.(entry.params, { stage: stageName, reason: reasonText }) ??
  copy.timeline.unknownEntry(entry.kind);

/**
 * The PR's Timeline tab (spec: prototype `findings.js` `TimelineTab`, `metrics.js` time
 * summary): how long the PR took and where the time went, then every entry, newest first, with
 * who acted and each finished run's final cost.
 */
export function TimelineTab({ repo, number }: PrTabProps) {
  const query = useQuery(timelineQuery(repo, number));
  const [filter, setFilter] = useState<Filter>('all');

  if (query.isPending) return <p className="text-text-3">{copy.timeline.loading}</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-bad">
        {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
      </p>
    );
  }

  const entries = [...query.data.entries]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .filter((entry) => matches(entry, filter));

  return (
    <div className="flex flex-col gap-3" data-tab="timeline">
      <TimeSummary summary={query.data.summary} />
      <div role="group" aria-label={copy.timeline.filterLabel} className="flex gap-1">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className="h-7 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text-2 aria-pressed:border-brand-line aria-pressed:bg-brand-bg aria-pressed:text-brand-text"
          >
            {copy.timeline.filters[key]}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-text-3">
          {query.data.entries.length === 0 ? copy.timeline.empty : copy.timeline.noMatch}
        </p>
      ) : (
        <ol
          aria-label={copy.timeline.entriesLabel}
          className="m-0 flex list-none flex-col divide-y divide-divider rounded-lg border border-border bg-surface p-0"
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-entry={entry.kind}
              data-actor={entry.actor.kind}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm"
            >
              <span className="font-medium" data-testid="entry-actor">
                {actorText(entry)}
              </span>
              {entry.params.via === 'github' && (
                <span className="text-xs text-text-3">{copy.timeline.inGitHub}</span>
              )}
              <span
                className={cn('min-w-[200px] flex-1', entry.kind === 'run_failed' && 'text-bad')}
              >
                {entryText(entry)}
              </span>
              {entry.costUsd !== null && (
                <span data-testid="entry-cost" className="text-xs text-text-2 tabular-nums">
                  {money(entry.costUsd)}
                </span>
              )}
              {entry.runId !== null && (
                <RunDetailsLink runId={entry.runId} className="text-xs text-brand-text" />
              )}
              <time dateTime={entry.at} className="text-xs text-text-3">
                {dateTime(entry.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TimeSummary({ summary }: { summary: TimelineResponse['summary'] }) {
  const t = copy.timeline;
  if (!summary.readyAt) {
    return (
      <p
        data-testid="time-summary"
        className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-3"
      >
        {t.notReady}
      </p>
    );
  }
  const items: [string, string, string | null][] = [
    [t.readyAt, dateTime(summary.readyAt), null],
    [t.total[summary.outcome], duration(summary.totalMs), null],
    [t.agentsWorked, duration(summary.agentsWorkedMs), 'bg-viz-agent'],
    [t.waiting, duration(summary.waitingMs), 'bg-viz-people'],
    [t.cost, money(summary.costUsd), null],
  ];
  return (
    <dl
      aria-label={t.summaryLabel}
      data-testid="time-summary"
      className="m-0 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
    >
      {items.map(([label, value, swatch]) => (
        <div key={label} className="flex items-center gap-1.5">
          {swatch && <span aria-hidden="true" className={cn('size-2 rounded-sm', swatch)} />}
          <dt className="text-text-3">{label}</dt>
          <dd className="m-0 font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
