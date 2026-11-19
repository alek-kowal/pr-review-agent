import type { AgentRole } from '@pra/core';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type { ModelsResponse } from '@/lib/api-types.ts';

const PATH = '/api/settings/models';
export const modelsKeys = { all: ['settings', 'models'] as const };

export const modelsQuery = () =>
  queryOptions({
    queryKey: modelsKeys.all,
    queryFn: ({ signal }) => apiGet<ModelsResponse>(PATH, signal),
  });

type RoleModels = Record<AgentRole, string>;

/** Saves every role's model, signed; the page refetches after it. */
export function useModelsChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: { before: RoleModels; after: RoleModels; signedBy: string }) =>
      apiRequest<ModelsResponse>(PATH, {
        method: 'PUT',
        body: { models: change.after, before: change.before, signedBy: change.signedBy },
      }),
    onSuccess: (data) => queryClient.setQueryData(modelsKeys.all, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}
