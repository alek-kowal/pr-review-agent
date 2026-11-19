import { useQuery } from '@tanstack/react-query';
import { CircleX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SEVERITIES } from '@pra/core';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import {
  isActiveStatus,
  type FindingView,
  type FindingsResponse,
  type RoundView,
} from '@/lib/api-types.ts';
import { errorText, reasonText, stageName } from '@/lib/reasons.ts';
import { useDecideFocus } from '@/features/pr/decide-focus.ts';
import { findingsQuery } from '@/features/pr/queries.ts';
import type { PrTabProps } from '@/features/pr/tabs.ts';
import { EmptyTab } from '@/features/pr/EmptyTab.tsx';
import { Finding } from './Finding.tsx';
import { FILTER_FROM, FINDING_FILTERS, needsDecision, type FindingFilterKey } from './filters.ts';
import { SeverityMark } from './SeverityMark.tsx';

/** The latest completed round's findings, grouped by severity, then what it did not check. */
export function FindingsTab({ repo, number, view }: PrTabProps) {
  const latest = view.latestRound;
  const active = isActiveStatus(latest?.status);
  const query = useQuery(findingsQuery(repo, number, active));
  const failedLine = latest?.status === 'failed' && latest.error && <RoundFailed round={latest} />;

  if (query.isPending) return <p className="text-text-3">{copy.findings.loading}</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-bad">
        {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
      </p>
    );
  }

  const { round } = query.data;
  if (!round) {
    const hint = !latest && view.pullRequest.isDraft ? copy.findings.empty.draft : null;
    return (
      <div className="flex flex-col gap-3">
        {failedLine}
        <EmptyTab text={active ? copy.findings.empty.waiting : copy.findings.empty.none} />
        {hint && <p className="text-sm text-text-3">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="findings-tab">
      {failedLine}
      {query.data.findings.length === 0 ? (
        <EmptyTab text={copy.findings.empty.clean(round.number)} />
      ) : (
        <FindingList
          // A newer round brings new findings: start again with all of them closed.
          key={round.id}
          findings={query.data.findings}
          slotProps={{ round, repo, number, view }}
        />
      )}
      <NotChecked items={query.data.notChecked} />
    </div>
  );
}

function RoundFailed({ round }: { round: RoundView }) {
  const error = round.error!;
  return (
    <p
      data-testid="round-failed"
      className="flex items-start gap-2 rounded-lg border border-bad-line bg-bad-bg px-3 py-2 text-[13px] text-text"
    >
      <CircleX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-bad" />
      {copy.round.failedAt(round.number, stageName(error.stage), reasonText(error.code))}
    </p>
  );
}

type SlotContext = {
  round: NonNullable<FindingsResponse['round']>;
  repo: string;
  number: string;
  view: PrTabProps['view'];
};

/** Refuted findings sink to the bottom of their group; otherwise the reviewer's order. */
const rank = (f: FindingView) => (f.verdict === 'refuted' ? 1 : 0);

/** Findings in the order the tab shows them: by severity, then `rank`, then the reviewer's. */
const inShownOrder = (findings: FindingView[]) =>
  SEVERITIES.flatMap((severity) =>
    findings
      .filter((f) => f.severity === severity)
      .sort((a, b) => rank(a) - rank(b) || a.ordinal - b.ordinal),
  );

function FindingList({ findings, slotProps }: { findings: FindingView[]; slotProps: SlotContext }) {
  const [filter, setFilter] = useState<FindingFilterKey>('all');
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const focus = useFocusOnDecide(findings, (id) => {
    setFilter('all');
    setOpen((prev) => new Set(prev).add(id));
  });

  const withFilter = findings.length >= FILTER_FROM;
  const matches = FINDING_FILTERS.find((x) => x.key === filter)!.matches;
  const shown = withFilter ? findings.filter(matches) : findings;
  const ordered = inShownOrder(shown);
  const groups = SEVERITIES.map((severity) => ({
    severity,
    items: ordered.filter((f) => f.severity === severity),
  })).filter((g) => g.items.length > 0);

  const ids = groups.flatMap((g) => g.items.map((f) => f.id));
  const allOpen = ids.length > 0 && ids.every((id) => open.has(id));
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const expandToggle = (
    <button
      type="button"
      onClick={() => setOpen(allOpen ? new Set() : new Set(ids))}
      className="cursor-pointer text-xs text-brand-text hover:underline"
    >
      {allOpen ? copy.findings.collapseAll : copy.findings.expandAll}
    </button>
  );

  return (
    <div ref={focus} className="flex flex-col gap-4">
      {withFilter && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label={copy.findings.filterLabel}
            className="inline-flex max-w-full gap-0.5 rounded-[7px] bg-inset p-0.5"
          >
            {FINDING_FILTERS.map(({ key }) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className="h-[26px] cursor-pointer rounded-[5px] px-2.5 text-xs font-medium text-text-2 aria-pressed:bg-surface aria-pressed:text-text aria-pressed:shadow-[0_0_0_1px_var(--border)]"
              >
                {copy.findings.filters[key]}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {expandToggle}
        </div>
      )}
      {groups.length === 0 && <EmptyTab text={copy.findings.noMatch} />}
      {groups.map(({ severity, items }, i) => {
        const names = copy.findings.severities[severity];
        return (
          <section key={severity} aria-label={names.group} className="flex flex-col gap-2">
            <div className="flex items-center">
              <h3 title={names.hint} className="flex items-center gap-2 text-sm font-semibold">
                <SeverityMark severity={severity} labelled={false} />
                {names.group}
                <span className="font-normal text-text-3">{items.length}</span>
              </h3>
              <span className="flex-1" />
              {i === 0 && !withFilter && expandToggle}
            </div>
            {items.map((f) => (
              <Finding
                key={f.id}
                finding={f}
                {...slotProps}
                open={open.has(f.id)}
                onToggle={() => toggle(f.id)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Answers the Decide main action: on each new request, `reveal` the first finding that needs a
 * decision (in shown order), then move focus to its line. Returns the list's ref.
 */
function useFocusOnDecide(findings: FindingView[], reveal: (id: number) => void) {
  const { request } = useDecideFocus();
  const [handled, setHandled] = useState(0);
  const [target, setTarget] = useState<{ id: number; request: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Adjusting state while rendering, as React suggests for a changed input: no effect needed.
  if (request !== 0 && request !== handled) {
    setHandled(request);
    const first = inShownOrder(findings).find(needsDecision);
    if (first) {
      reveal(first.id);
      setTarget({ id: first.id, request });
    }
  }

  useEffect(() => {
    if (!target) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-finding-id="${target.id}"] [aria-expanded]`)
      ?.focus();
  }, [target]);

  return list;
}

function NotChecked({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={copy.findings.notChecked} className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">{copy.findings.notChecked}</h3>
      <p className="text-xs text-text-3">{copy.findings.notCheckedHint}</p>
      <ul className="list-disc pl-5 text-sm text-text-2">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
