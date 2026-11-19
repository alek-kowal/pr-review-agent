import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type { TrialDetailResponse, TrialsListResponse } from '@/lib/api-types.ts';

// Live updates (`src/live`) invalidate these when a run changes, so a running trial fills in.
export const trialKeys = {
  all: ['trials'] as const,
  one: (id: number) => ['trials', id] as const,
};

/** Every trial, newest first. */
export const trialsQuery = () =>
  queryOptions({
    queryKey: trialKeys.all,
    queryFn: ({ signal }) => apiGet<TrialsListResponse>('/api/trials', signal),
  });

/** One trial with both runs, the compare buckets and the instruction diff. */
export const trialQuery = (id: number) =>
  queryOptions({
    queryKey: trialKeys.one(id),
    queryFn: ({ signal }) => apiGet<TrialDetailResponse>(`/api/trials/${id}`, signal),
  });

export type StartTrial = { pr: { repo: string; number: number }; instructionDraft: number };

/** Starts a trial (unsigned, "Started by hand"); the answer is the new trial. */
export function useStartTrial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StartTrial) =>
      apiRequest<TrialDetailResponse>('/api/trials', { method: 'POST', body }),
    onSuccess: (detail) => queryClient.setQueryData(trialKeys.one(detail.trial.id), detail),
    onSettled: () => queryClient.invalidateQueries({ queryKey: trialKeys.all }),
  });
}
