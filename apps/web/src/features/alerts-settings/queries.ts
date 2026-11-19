import type { AlertConfig } from '@pra/core';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type { AlertSettingsResponse } from '@/lib/api-types.ts';

const PATH = '/api/settings/alerts';
export const alertSettingsKeys = { all: ['settings', 'alerts'] as const };

export const alertSettingsQuery = () =>
  queryOptions({
    queryKey: alertSettingsKeys.all,
    queryFn: ({ signal }) => apiGet<AlertSettingsResponse>(PATH, signal),
  });

/** Saves the alert settings, signed; the page refetches after it. */
export function useAlertSettingsChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: { before: AlertConfig; after: AlertConfig; signedBy: string }) =>
      apiRequest<AlertSettingsResponse>(PATH, {
        method: 'PUT',
        body: { config: change.after, before: change.before, signedBy: change.signedBy },
      }),
    onSuccess: (data) => queryClient.setQueryData(alertSettingsKeys.all, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}
