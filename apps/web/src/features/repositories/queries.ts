import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type {
  RepositoriesSettingsResponse,
  RepositorySettings,
  RepositorySettingsResponse,
} from '@/lib/api-types.ts';

export const repositorySettingsKeys = {
  all: ['settings', 'repositories'] as const,
  one: (id: number) => ['settings', 'repositories', id] as const,
};

/** Connected repositories and the ones the GitHub App can reach that are not connected yet. */
export const repositoriesSettingsQuery = () =>
  queryOptions({
    queryKey: repositorySettingsKeys.all,
    queryFn: ({ signal }) =>
      apiGet<RepositoriesSettingsResponse>('/api/settings/repositories', signal),
  });

export const repositorySettingsQuery = (id: number) =>
  queryOptions({
    queryKey: repositorySettingsKeys.one(id),
    queryFn: ({ signal }) =>
      apiGet<RepositorySettingsResponse>(`/api/settings/repositories/${id}`, signal),
  });

type Change =
  | { kind: 'connect'; fullName: string; config: RepositorySettings; signedBy: string }
  | {
      kind: 'edit';
      id: number;
      before: RepositorySettingsResponse['repository']['config'];
      config: RepositorySettings;
      signedBy: string;
    };

/** Connect a repository or save its settings, signed; the repository queries refetch after it. */
export function useRepositoryChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) =>
      change.kind === 'connect'
        ? apiRequest<RepositorySettingsResponse>('/api/settings/repositories', {
            method: 'POST',
            body: { fullName: change.fullName, config: change.config, signedBy: change.signedBy },
          })
        : apiRequest<RepositorySettingsResponse>(`/api/settings/repositories/${change.id}`, {
            method: 'PUT',
            body: { config: change.config, before: change.before, signedBy: change.signedBy },
          }),
    onSuccess: ({ repository }) =>
      queryClient.setQueryData(repositorySettingsKeys.one(repository.id), { repository }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: repositorySettingsKeys.all }),
  });
}
