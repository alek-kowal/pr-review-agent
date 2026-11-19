// Cancel a queued or running run (S-09-T4): unsigned, recorded "by hand". The api answers 202
// once the request is stored; the worker stops the run and the live channel refreshes the views.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { copy } from '@/copy/index.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { activityKeys } from '@/features/activity/queries.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { runKeys } from './queries.ts';

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) =>
      apiRequest<{ status: 'cancelling' }>(`/api/runs/${runId}/cancel`, { method: 'POST' }),
    onSuccess: (_result, runId) => {
      toast.success(copy.runs.cancel.requested);
      void queryClient.invalidateQueries({ queryKey: ['pr'] });
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) });
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
    onError: (error) => {
      toast.error(errorText(error instanceof ApiError ? error.code : 'http_error'));
    },
  });
}
