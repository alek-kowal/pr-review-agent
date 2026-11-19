import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { dateTime } from '@/copy/format.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { trialsQuery } from './queries.ts';

const t = copy.trials.experiments;

/** Settings → Experiments (S-22-T8, FR-080): every trial, newest first, each opening its Compare. */
export function ExperimentsPage() {
  const query = useQuery(trialsQuery());
  const trials = query.data?.trials;
  const c = t.columns;

  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {!trials ? (
        query.isError ? (
          <p role="alert" data-work-start className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : trials.length === 0 ? (
        <p data-work-start className="text-text-3">
          {t.empty}
        </p>
      ) : (
        <div data-work-start className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t.tableLabel}</caption>
            <thead className="bg-surface-2 text-xs text-text-3">
              <tr>
                {[c.trial, c.pr, c.draft, c.status, c.started].map((name) => (
                  <th key={name} scope="col" className="px-3 py-2 font-semibold">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trials.map((trial) => (
                <tr key={trial.id} className="border-t border-divider">
                  <th scope="row" className="px-3 py-2 font-medium">
                    <Link
                      to="/settings/experiments/$id"
                      params={{ id: String(trial.id) }}
                      className="text-brand-text hover:underline"
                    >
                      {t.trial(trial.id)}
                    </Link>
                  </th>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[13px]">
                      {t.pr(trial.pr.repo, trial.pr.number)}
                    </span>{' '}
                    <span className="text-text-2">{trial.pr.title}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[13px]">
                    {t.draft(trial.draft.fileKey, trial.draft.version)}
                  </td>
                  <td className="px-3 py-2">{copy.trials.status[trial.status] ?? trial.status}</td>
                  <td className="px-3 py-2 text-text-2">
                    <time dateTime={trial.createdAt}>{dateTime(trial.createdAt)}</time>
                    {trial.startedBy === 'hand' && (
                      <span className="block text-xs text-text-3">{t.startedByHand}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsPage>
  );
}
