// Alerts (S-18): the active and past lists, and Dismiss (unsigned, recorded "by hand"). The keys
// sit under `activity`, so live changes of the `alerts` table refresh them with Activity.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { copy } from '@/copy/index.ts';
import { ApiError, apiGet, apiRequest } from '@/lib/api.ts';
import type { AlertsResponse, AlertView } from '@/lib/api-types.ts';
import { errorText, reasonText, stageName } from '@/lib/reasons.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { statusKeys } from '@/features/shell/status-query.ts';

export type AlertListStatus = 'active' | 'past';

export const alertKeys = {
  all: ['activity', 'alerts'] as const,
  list: (status: AlertListStatus) => ['activity', 'alerts', status] as const,
};

export const alertsQuery = (status: AlertListStatus = 'active') =>
  queryOptions({
    queryKey: alertKeys.list(status),
    queryFn: ({ signal }) => apiGet<AlertsResponse>(`/api/alerts?status=${status}`, signal),
  });

/** Stage and failure names for the alert copy. */
export const alertNames = { stage: stageName, reason: reasonText };

export const alertTitle = (alert: AlertView) => copy.alerts.title(alert.title, alertNames);
export const alertNextStep = (alert: AlertView) => copy.alerts.nextStep(alert.nextStep, alertNames);

export function useDismissAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<{ alert: AlertView }>(`/api/alerts/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(copy.alerts.dismiss.done, { description: copy.alerts.dismiss.doneDetail });
      void queryClient.invalidateQueries({ queryKey: alertKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['pr'] });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
      void queryClient.invalidateQueries({ queryKey: statusKeys.all });
    },
    onError: (error) => {
      toast.error(errorText(error instanceof ApiError ? error.code : 'http_error'));
    },
  });
}
