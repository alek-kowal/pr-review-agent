import { useQuery } from '@tanstack/react-query';
import { copy } from '@/copy/index.ts';
import { InsightsFilters } from './InsightsFilters.tsx';
import { RateCells } from './parts.tsx';
import { qualityQuery } from './queries.ts';
import { DEFAULT_RANGE, type InsightsSearch } from './search.ts';
import type { QualityResponse } from './types.ts';

const t = copy.insights;
const th = 'px-3 py-1.5 font-medium';
const num = 'px-3 py-1.5 text-right tabular-nums';

/** Insights → Quality: verdict and decision rates per review level and instruction version. */
export function QualityTab({ search }: { search: InsightsSearch }) {
  const range = search.range ?? DEFAULT_RANGE;
  const query = useQuery(qualityQuery({ range, repo: search.repo }));
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
          <>
            <PerLevel levels={query.data.levels} />
            <PerVersion versions={query.data.versions} />
          </>
        )}
      </div>
    </div>
  );
}

function PerLevel({ levels }: { levels: QualityResponse['levels'] }) {
  const q = t.quality;
  return (
    <section aria-labelledby="quality-levels" className="flex flex-col gap-2">
      <h2 id="quality-levels" className="m-0 font-heading text-sm font-semibold">
        {q.perLevel}
      </h2>
      <p className="m-0 text-xs text-text-3">{q.perLevelHint}</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-[13px]" aria-labelledby="quality-levels">
          <thead className="text-left text-text-3">
            <tr>
              <th className={th}>{q.columns.level}</th>
              <th className={`${th} text-right`}>{q.columns.rounds}</th>
              <th className={`${th} text-right`}>{q.columns.findings}</th>
              <th className={`${th} text-right`}>{q.columns.confirmed}</th>
              <th className={`${th} text-right`}>{q.columns.refuted}</th>
              <th className={`${th} text-right`}>{q.columns.implement}</th>
              <th className={`${th} text-right`}>{q.columns.averageRound}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {levels.map((row) => (
              <tr key={row.level}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">
                  {t.level(row.level)}
                </th>
                <td className={num}>{row.rounds}</td>
                <td className={num}>{row.findings}</td>
                <RateCells rates={row} refuted />
                <td className={num}>
                  {row.averageRoundUsd === null ? t.none : t.money(row.averageRoundUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PerVersion({ versions }: { versions: QualityResponse['versions'] }) {
  const q = t.quality;
  return (
    <section aria-labelledby="quality-versions" className="flex flex-col gap-2">
      <h2 id="quality-versions" className="m-0 font-heading text-sm font-semibold">
        {q.perVersion}
      </h2>
      {versions.length === 0 ? (
        <p className="m-0 text-sm text-text-3">{q.noRuns}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-[13px]" aria-labelledby="quality-versions">
            <thead className="text-left text-text-3">
              <tr>
                <th className={th}>{q.columns.instruction}</th>
                <th className={th}>{q.columns.version}</th>
                <th className={`${th} text-right`}>{q.columns.runs}</th>
                <th className={`${th} text-right`}>{q.columns.findings}</th>
                <th className={`${th} text-right`}>{q.columns.confirmed}</th>
                <th className={`${th} text-right`}>{q.columns.implement}</th>
                <th className={`${th} text-right`}>{q.columns.averageCost}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {versions.map((row) => {
                const i = row.instruction;
                return (
                  <tr key={i?.id ?? 'none'}>
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      {i ? (
                        <span className="font-mono">
                          {i.fileKey}
                          {i.repository && <span className="text-text-3"> · {i.repository}</span>}
                        </span>
                      ) : (
                        <span className="text-text-3">{q.noVersion}</span>
                      )}
                    </th>
                    <td className="px-3 py-1.5">{i ? q.version(i.version, i.active) : t.none}</td>
                    <td className={num}>{row.runs}</td>
                    <td className={num}>{row.findings}</td>
                    <RateCells rates={row} refuted={false} />
                    <td className={num}>
                      {row.averageCostUsd === null ? t.none : t.money(row.averageCostUsd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
