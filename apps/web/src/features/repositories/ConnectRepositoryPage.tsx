import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { useGitHubMode } from '@/features/shell/status-query.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { newRepositorySettings, toForm } from './form-model.ts';
import {
  repositoriesSettingsQuery,
  repositoryLookupQuery,
  useRepositoryChange,
} from './queries.ts';
import { RepositoryEditor } from './RepositoryEditor.tsx';

const t = copy.repositories;

type Target = { fullName: string; defaultBranch: string };
type Found = { pending: true } | { pending: false; target: Target | null; problem: string | null };

/**
 * Connect a repository: one the GitHub App can reach, or, without the App (P-28), one GitHub
 * shows by name (its default branch prefilled). Its settings, then one signed save.
 */
export function ConnectRepositoryPage({ fullName }: { fullName: string }) {
  const mode = useGitHubMode();
  const byName = mode !== undefined && mode !== 'app';
  const listed = useQuery({ ...repositoriesSettingsQuery(), enabled: mode === 'app' });
  const lookup = useQuery({ ...repositoryLookupQuery(fullName), enabled: byName });
  const change = useRepositoryChange();
  const navigate = useNavigate();

  const found: Found = useMemo(() => {
    if (mode === undefined) return { pending: true };
    if (byName) {
      if (lookup.isPending) return { pending: true };
      if (lookup.isError) {
        const code = lookup.error instanceof ApiError ? lookup.error.code : 'http_error';
        return {
          pending: false,
          target: null,
          problem:
            code === 'repository_not_reachable'
              ? t.connectPage.notFound(fullName)
              : code === 'repository_already_connected'
                ? t.connectPage.alreadyConnected(fullName)
                : errorText(code),
        };
      }
      return { pending: false, target: lookup.data.repository, problem: null };
    }
    if (listed.isPending) return { pending: true };
    if (listed.isError) {
      const code = listed.error instanceof ApiError ? listed.error.code : 'http_error';
      return { pending: false, target: null, problem: errorText(code) };
    }
    const target = listed.data.available.find(
      (r) => r.fullName.toLowerCase() === fullName.toLowerCase(),
    );
    return target
      ? { pending: false, target, problem: null }
      : { pending: false, target: null, problem: t.connectPage.notReachable(fullName) };
  }, [mode, byName, fullName, lookup, listed]);

  const target = found.pending ? null : found.target;
  const saved = useMemo(
    () => (target ? toForm(newRepositorySettings(target.defaultBranch)) : null),
    [target],
  );

  return (
    <SettingsPage
      title={t.connectPage.title(fullName)}
      affects={byName ? t.connectPage.polledAffects(fullName) : t.connectPage.affects(fullName)}
    >
      {found.pending ? (
        <p className="text-text-3">{byName ? t.connectPage.checking(fullName) : t.loading}</p>
      ) : !target || !saved ? (
        <p role="alert" data-work-start className="text-bad">
          {found.problem}
        </p>
      ) : (
        <RepositoryEditor
          saved={saved}
          dialogTitle={t.connectPage.dialogTitle(target.fullName)}
          connect={{
            message: t.connectPage.pending,
            saveLabel: t.connectPage.save,
            description: t.connectPage.dialogDescription,
            confirmLabel: t.connectPage.confirm,
          }}
          onSave={async (config, signedBy) => {
            const { repository } = await change.mutateAsync({
              kind: 'connect',
              fullName: target.fullName,
              config,
              signedBy,
            });
            await navigate({
              to: '/settings/repositories/$id',
              params: { id: String(repository.id) },
              ignoreBlocker: true,
            });
          }}
        />
      )}
    </SettingsPage>
  );
}
