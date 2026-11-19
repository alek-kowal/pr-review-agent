import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
      </div>
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
