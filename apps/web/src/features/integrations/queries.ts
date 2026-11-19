import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type {
  ClickUpTestResponse,
  IntegrationSettings,
  IntegrationsResponse,
} from '@/lib/api-types.ts';

const PATH = '/api/settings/integrations';
export const integrationsKeys = { all: ['settings', 'integrations'] as const };

export const integrationsQuery = () =>
  queryOptions({
    queryKey: integrationsKeys.all,
    queryFn: ({ signal }) => apiGet<IntegrationsResponse>(PATH, signal),
  });

/** Saves the integration settings, signed; the status refetches after it. */
export function useIntegrationSettingsChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: {
      before: IntegrationSettings;
      after: IntegrationSettings;
      signedBy: string;
    }) =>
      apiRequest<{ settings: IntegrationSettings }>(PATH, {
        method: 'PUT',
        body: { ...change.after, before: change.before, signedBy: change.signedBy },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: integrationsKeys.all }),
  });
}

/** Asks ClickUp who the key belongs to; the answer is the test's result, ok or not. */
export function useClickUpTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<ClickUpTestResponse>(`${PATH}/clickup/test`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: integrationsKeys.all }),
  });
}
