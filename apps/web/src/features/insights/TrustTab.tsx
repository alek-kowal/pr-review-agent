import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleDashed, Info } from 'lucide-react';
import { LEVEL_NUMBERS } from '@pra/core';
import { copy } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';
import { InsightsFilters } from './InsightsFilters.tsx';
import { trustQuery } from './queries.ts';
import type { InsightsSearch } from './search.ts';
import type { TrustResponse } from './types.ts';

const t = copy.insights;

/** Insights → Trust ladder: one card per repository with its level and that level's record. */
export function TrustTab({ search }: { search: InsightsSearch }) {
  const query = useQuery(trustQuery({ repo: search.repo }));
  return (
    <div className="flex flex-col gap-4">
      <InsightsFilters search={search} show={['repo']} />
      <div data-work-start className="flex flex-col gap-4">
        {query.isPending ? (
          <p className="text-text-3">{t.loading}</p>
        ) : query.isError ? (
          <p role="alert" className="text-bad">
            {t.failed}
          </p>
        ) : query.data.repositories.length === 0 ? (
          <p className="text-text-3">{t.trust.empty}</p>
        ) : (
          query.data.repositories.map((row) => <RepositoryCard key={row.repositoryId} row={row} />)
        )}
      </div>
    </div>
  );
}

type Row = TrustResponse['repositories'][number];

function RepositoryCard({ row }: { row: Row }) {
  const id = `trust-${row.repositoryId}`;
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider px-4 py-2.5">
        <h2 id={id} className="m-0 font-heading text-sm font-semibold" title={t.trust.cardHint}>
          {row.repository}
        </h2>
        <Link
          to="/settings/repositories/$id"
          params={{ id: String(row.repositoryId) }}
          className="text-xs"
        >
          {t.trust.changeLevel}
        </Link>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <ol aria-label={t.trust.ladderLabel} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {LEVEL_NUMBERS.map((n) => (
            <li
              key={n}
              aria-current={n === row.level ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs',
                n === row.level
                  ? 'border-brand bg-brand-bg font-semibold'
                  : n < row.level
                    ? 'border-border'
                    : 'border-dashed border-border text-text-3',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex size-[22px] items-center justify-center rounded-full text-[12px]',
                  n <= row.level ? 'bg-brand text-on-brand' : 'bg-inset text-text-3',
                )}
              >
                {n}
              </span>
              {t.level(n)}
            </li>
          ))}
        </ol>
        <p className="m-0 text-sm">
          <span className="font-semibold">{t.trust.heading(row.level, row.days)}</span>{' '}
          {summary(row)}{' '}
          <span className="text-text-3">{t.trust.basedOn(row.findings, row.rounds)}</span>
        </p>
        <ShadowLog row={row} />
      </div>
    </section>
  );
}

/** An ⓘ whose text is its title, also read by screen readers. */
function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} className="ml-1 inline-flex align-[-2px] text-text-3">
      <Info aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** "Level 5 shadow log": what level 5 would have done per PR, once 5 PRs have an entry. */
function ShadowLog({ row }: { row: Row }) {
  const s = t.trust.shadow;
  const { shadow } = row;
  const id = `shadow-${row.repositoryId}`;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="m-0 mb-1 text-xs font-semibold text-text-2">
        {s.title}
      </h3>
      {shadow.eligible < shadow.needed ? (
        <p className="m-0 text-sm text-text-3">
          {s.notEnough(shadow.eligible, shadow.needed)}
          <InfoTip text={s.startsAtLevel3} />
        </p>
      ) : (
        <>
          <p className="m-0 text-sm">
            <span className="font-semibold">{s.summary(shadow.wouldFix, shadow.eligible)}</span>{' '}
            <span className="text-text-3">· {s.lastDays(shadow.days)}</span>
            <InfoTip text={s.nothingPushed} />
          </p>
          <ul
            aria-label={s.listLabel}
            className="m-0 mt-2 list-none divide-y divide-divider rounded-lg border border-divider p-0"
          >
            {shadow.prs.map((pr) => {
              const fixes = pr.decision !== 'would_wait';
              const Icon = fixes ? CircleCheck : CircleDashed;
              return (
                <li key={pr.number} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Icon
                    aria-hidden="true"
                    className={cn('size-3.5 shrink-0', fixes ? 'text-ok' : 'text-text-3')}
                  />
                  <Link
                    to="/pr/$repo/$number"
                    params={{ repo: row.repository, number: String(pr.number) }}
                    className="font-mono"
                  >
                    #{pr.number}
                  </Link>
                  <span className={fixes ? undefined : 'text-text-2'}>{s.row(pr)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function summary(row: Row): string {
  if (row.tooFew) return t.trust.tooFew(row.findings);
  if (row.implementShare === null) return t.trust.noDecided;
  const implement = t.percent(row.implementShare);
  if (row.unchecked || row.confirmedRate === null || row.refutedRate === null) {
    return t.trust.ratesUnchecked(implement);
  }
  return t.trust.rates(implement, t.percent(row.confirmedRate), t.percent(row.refutedRate));
}
