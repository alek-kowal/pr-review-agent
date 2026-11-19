// Retry a failed round from its failed stage (S-09-T2): unsigned, recorded "by hand".
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { copy } from '@/copy/index.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import type { RetryRunResponse } from '@/lib/api-types.ts';
import { errorText, stageName } from '@/lib/reasons.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys } from '@/features/pr/queries.ts';
import { runKeys } from './queries.ts';

export function useRetryRun(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) =>
      apiRequest<RetryRunResponse>(`/api/runs/${runId}/retry`, { method: 'POST' }),
    onSuccess: (result, runId) => {
      toast.success(copy.runs.retry.started(stageName(result.run.fromStage)));
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
    onError: (error) => {
      toast.error(errorText(error instanceof ApiError ? error.code : 'http_error'));
    },
  });
}
