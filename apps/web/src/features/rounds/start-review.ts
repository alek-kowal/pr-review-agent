// Start review by hand (S-07-T5): the request, the caches it refreshes and the toasts.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LevelNumber } from '@pra/core';
import { copy } from '@/copy/index.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import type { PrView, StartReviewResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys } from '@/features/pr/queries.ts';

const prPath = (repo: string, number: string) =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;

export function useStartReview(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (level: LevelNumber) =>
      apiRequest<StartReviewResponse>(`${prPath(repo, number)}/start-review`, {
        method: 'POST',
        body: { level },
      }),
    onSuccess: (result) => {
      toast.success(copy.startReview.started(result.roundNumber, result.level));
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
    onError: (error) => {
      toast.error(errorText(error instanceof ApiError ? error.code : 'http_error'));
    },
  });
}

/** Why a start is not possible now: a round is queued, or a run is in progress. */
export function startBlockedReason(view: PrView): string | null {
  const status = view.latestRound?.status;
  if (status === 'queued') return copy.startReview.queued;
  if (status === 'running') return copy.startReview.running;
  return null;
}
