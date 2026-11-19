import { useMutation, useQueryClient } from '@tanstack/react-query';
import { statusKeys } from '@/features/shell/status-query.ts';
import { apiRequest } from '@/lib/api.ts';
import type { StatusResponse } from '@/lib/api-types.ts';

type Signed = { signedBy: string };

export type StatusChange =
  | ({ kind: 'pause'; reason: string } & Signed)
  | ({ kind: 'resume' } & Signed)
  | ({ kind: 'budget'; dailyBudgetUsd: number | null; before: number | null } & Signed)
  | ({ kind: 'slots'; agentSlots: number; before: number } & Signed);

/** Sends one signed status change; every route answers with the new status. */
function send(change: StatusChange): Promise<StatusResponse> {
  switch (change.kind) {
    case 'pause':
      return apiRequest('/api/status/pause', {
        method: 'POST',
        body: { reason: change.reason, signedBy: change.signedBy },
      });
    case 'resume':
      return apiRequest('/api/status/resume', {
        method: 'POST',
        body: { signedBy: change.signedBy },
      });
    case 'budget':
      return apiRequest('/api/status/budget', {
        method: 'PUT',
        body: {
          dailyBudgetUsd: change.dailyBudgetUsd,
          before: { dailyBudgetUsd: change.before },
          signedBy: change.signedBy,
        },
      });
    case 'slots':
      return apiRequest('/api/status/slots', {
        method: 'PUT',
        body: {
          agentSlots: change.agentSlots,
          before: { agentSlots: change.before },
          signedBy: change.signedBy,
        },
      });
  }
}

/**
 * Pause, resume, daily budget and agent slots. The answer is the new status, so the chip shows
 * it right away; a refused change refetches what is stored.
 */
export function useStatusChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (status) => queryClient.setQueryData(statusKeys.all, status),
    onError: () => queryClient.invalidateQueries({ queryKey: statusKeys.all }),
  });
}
