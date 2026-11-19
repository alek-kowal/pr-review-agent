import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { clock, money } from '@/copy/format.ts';
import { usePauseNames, waitText } from '@/features/budget/wait-text.ts';
import { RunDetailsLink } from '@/features/runs/RunDetailsLink.tsx';
import { ApiError } from '@/lib/api.ts';
import type { InProgressRun } from '@/lib/api-types.ts';
import { errorText, stageName } from '@/lib/reasons.ts';
import { inProgressQuery } from './queries.ts';
import { ACTIVITY_SECTIONS, IN_PROGRESS_ROW_ACTIONS } from './slots.ts';

/**
 * The Activity page (spec: prototype `pages.js` `ActivityPage`): every running and queued run,
 * updated live through `/api/live`. Alerts and Finished today plug in as `ACTIVITY_SECTIONS`.
 */
export function ActivityPage() {
  const sections = (position: 'before' | 'after') =>
    ACTIVITY_SECTIONS.filter((s) => s.position === position).map(({ key, Component }) => (
      <Component key={key} />
    ));
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-heading text-xl font-semibold">{copy.activity.title}</h1>
      {sections('before')}
      <InProgressSection />
      {sections('after')}
    </div>
  );
}

const runName = (run: InProgressRun) =>
  copy.runs.kinds[run.kind]?.(run.roundNumber) ?? copy.runs.unknownKind(run.kind);

function InProgressSection() {
  const t = copy.activity.inProgress;
  const query = useQuery(inProgressQuery());
  const runs = query.data?.runs ?? [];

  return (
    <section aria-labelledby="activity-in-progress" data-work-start className="flex flex-col gap-2">
      <h2 id="activity-in-progress" className="m-0 flex items-center gap-2 text-sm font-semibold">
        {t.title}
        {runs.length > 0 && (
          <span className="rounded-full bg-surface-2 px-1.5 text-xs text-text-2 tabular-nums">
            {runs.length}
          </span>
        )}
      </h2>
      {query.isPending ? (
        <p className="text-sm text-text-3">{copy.activity.loading}</p>
      ) : query.isError ? (
        <p role="alert" className="text-bad">
          {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
        </p>
      ) : runs.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-3">
          {t.empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table aria-label={t.title} className="w-full text-left text-sm">
            <thead className="text-xs text-text-3">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t.columns.pullRequest}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.columns.run}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.columns.stage}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.columns.started}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.columns.cost}
                </th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">{t.columns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider border-t border-divider">
              {runs.map((run) => (
                <InProgressRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InProgressRow({ run }: { run: InProgressRun }) {
  const t = copy.activity.inProgress;
  const pr = run.pullRequest;
  // A started run that waits before an agent session reads as queued too (S-10).
  const queued = run.status === 'queued' || Boolean(run.wait);
  const names = usePauseNames();
  return (
    <tr data-run={run.id} data-status={run.status}>
      <td className="px-4 py-2.5">
        <Link
          to="/pr/$repo/$number"
          params={{ repo: pr.repository.slug, number: String(pr.number) }}
          className="font-medium text-text"
        >
          {pr.title}
        </Link>{' '}
        <span className="font-mono text-xs text-text-3">#{pr.number}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <RunDetailsLink runId={run.id}>{runName(run)}</RunDetailsLink>
      </td>
      <td className="px-3 py-2.5" data-testid="run-stage">
        {queued ? (
          <span className="text-text-2">{waitText(run.wait ?? null, names)}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-brand" />
            <span className="font-medium">
              {run.currentStage ? stageName(run.currentStage) : t.starting}
            </span>
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-text-2 tabular-nums">
        {run.startedAt ? (
          <time dateTime={run.startedAt}>{clock(run.startedAt)}</time>
        ) : (
          t.notStarted
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-medium tabular-nums" data-testid="run-cost">
        {money(run.costUsd)}
      </td>
      <td className="px-4 py-2.5 text-right">
        {IN_PROGRESS_ROW_ACTIONS.map(({ key, Component }) => (
          <Component key={key} run={run} />
        ))}
      </td>
    </tr>
  );
}
