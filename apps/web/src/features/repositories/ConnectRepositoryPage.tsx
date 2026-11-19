import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { newRepositorySettings, toForm } from './form-model.ts';
import { repositoriesSettingsQuery, useRepositoryChange } from './queries.ts';
import { RepositoryEditor } from './RepositoryEditor.tsx';

const t = copy.repositories;

/** Connect a repository the GitHub App can reach: its settings, then one signed save. */
export function ConnectRepositoryPage({ fullName }: { fullName: string }) {
  const query = useQuery(repositoriesSettingsQuery());
  const change = useRepositoryChange();
  const navigate = useNavigate();
  const target = query.data?.available.find(
    (r) => r.fullName.toLowerCase() === fullName.toLowerCase(),
  );
  const saved = useMemo(
    () => (target ? toForm(newRepositorySettings(target.defaultBranch)) : null),
    [target],
  );

  return (
    <SettingsPage title={t.connectPage.title(fullName)} affects={t.connectPage.affects(fullName)}>
      {query.isPending ? (
        <p className="text-text-3">{t.loading}</p>
      ) : query.isError ? (
        <p role="alert" className="text-bad">
          {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
        </p>
      ) : !target || !saved ? (
        <p role="alert" className="text-bad">
          {t.connectPage.notReachable(fullName)}
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
