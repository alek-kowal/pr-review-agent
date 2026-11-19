import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { toForm } from './form-model.ts';
import { repositorySettingsQuery, useRepositoryChange } from './queries.ts';
import { RepositoryEditor } from './RepositoryEditor.tsx';

const t = copy.repositories;

/** Settings → Repositories → one repository: every RepositoryConfig field, saved signed. */
export function RepositoryPage({ id }: { id: number }) {
  const query = useQuery(repositorySettingsQuery(id));
  const change = useRepositoryChange();
  const repository = query.data?.repository;
  const saved = useMemo(() => (repository ? toForm(repository.config) : null), [repository]);

  if (!repository || !saved) {
    return (
      <SettingsPage title={t.title} affects={t.affects}>
        {query.isError ? (
          <p role="alert" className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.page.loading}</p>
        )}
      </SettingsPage>
    );
  }

  const name = repository.githubFullName;
  return (
    <SettingsPage title={name} affects={t.page.affects(name)}>
      <Breadcrumb name={name} />
      <RepositoryEditor
        saved={saved}
        dialogTitle={t.page.saveTitle(name)}
        onSave={(config, signedBy) =>
          change.mutateAsync({
            kind: 'edit',
            id: repository.id,
            before: repository.config,
            config,
            signedBy,
          })
        }
      />
    </SettingsPage>
  );
}

export function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label={t.page.breadcrumb} className="text-sm text-text-3">
      <Link to="/settings/repositories" className="hover:underline">
        {t.page.back}
      </Link>
      <ChevronRight aria-hidden="true" className="mx-1 inline size-3.5" />
      <span className="font-mono text-[13px]">{name}</span>
    </nav>
  );
}
