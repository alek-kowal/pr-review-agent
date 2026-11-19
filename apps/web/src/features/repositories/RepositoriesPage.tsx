import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { ConnectPicker } from './ConnectPicker.tsx';
import { repositoriesSettingsQuery } from './queries.ts';

const t = copy.repositories;

/** Settings → Repositories (FR-077): the connected repositories and "Connect a repository". */
export function RepositoriesPage() {
  const query = useQuery(repositoriesSettingsQuery());
  const data = query.data;

  return (
    <SettingsPage
      title={t.title}
      affects={t.affects}
      actions={
        data &&
        !data.availableError && (
          <ConnectPicker
            available={data.available}
            connected={data.repositories.map((r) => r.githubFullName)}
          />
        )
      }
    >
      {!data ? (
        query.isError ? (
          <p role="alert" className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : (
        <>
          {data.availableError && (
            <p role="status" className="text-sm text-text-2">
              {t.connect.unavailable(errorText(data.availableError.code))}
            </p>
          )}
          {data.repositories.length === 0 ? (
            <p className="text-text-3">{t.empty}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t.tableLabel}</caption>
                <thead className="bg-surface-2 text-xs text-text-3">
                  <tr>
                    {[t.columns.repository, t.columns.level, t.columns.clickup].map((c) => (
                      <th key={c} scope="col" className="px-3 py-2 font-semibold">
                        {c}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t.columns.sensitive}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t.columns.branch}
                    </th>
                    <th scope="col" className="w-8 px-3 py-2">
                      <span className="sr-only">{t.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.repositories.map((repository) => {
                    const { config } = repository;
                    return (
                      <tr key={repository.id} className="border-t border-divider">
                        <th scope="row" className="px-3 py-2 font-medium">
                          <Link
                            to="/settings/repositories/$id"
                            params={{ id: String(repository.id) }}
                            className="font-mono text-[13px] text-brand-text hover:underline"
                          >
                            {repository.githubFullName}
                          </Link>
                        </th>
                        <td className="px-3 py-2">{t.level(config.defaultLevel)}</td>
                        <td className="px-3 py-2">{config.clickup ? t.on : t.off}</td>
                        <td className="px-3 py-2 text-text-2">
                          {t.patterns(config.sensitivePatterns.length)}
                        </td>
                        <td className="px-3 py-2 font-mono text-[13px]">{config.defaultBranch}</td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            to="/settings/repositories/$id"
                            params={{ id: String(repository.id) }}
                            aria-label={t.open(repository.githubFullName)}
                            className="inline-flex text-text-3 hover:text-text"
                          >
                            <ChevronRight aria-hidden="true" className="size-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-text-3">{t.fromGithubApp}</p>
        </>
      )}
    </SettingsPage>
  );
}
