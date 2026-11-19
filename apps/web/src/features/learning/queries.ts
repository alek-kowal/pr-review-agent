import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type {
  LearningCandidatesResponse,
  LessonCandidateView,
  LessonDraftResponse,
} from '@/lib/api-types.ts';

export const learningKeys = {
  candidates: ['learning', 'candidates'] as const,
};

/** Every lesson candidate with its source PRs, newest first. */
export const candidatesQuery = () =>
  queryOptions({
    queryKey: learningKeys.candidates,
    queryFn: ({ signal }) => apiGet<LearningCandidatesResponse>('/api/learning/candidates', signal),
  });

function useCandidateMutation<Body>(path: (id: number) => string, method: 'PUT' | 'POST') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Body }) =>
      apiRequest<LessonCandidateView>(path(id), { method, body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: learningKeys.candidates }),
  });
}

/** Edit inline: unsigned, recorded "by hand". */
export const useEditCandidate = () =>
  useCandidateMutation<{ title: string; text: string }>(
    (id) => `/api/learning/candidates/${id}`,
    'PUT',
  );

/** Reject: signed, with a reason. `text` is what the signer saw. */
export const useRejectCandidate = () =>
  useCandidateMutation<{ reason: string; signedBy: string | null; text: string }>(
    (id) => `/api/learning/candidates/${id}/reject`,
    'POST',
  );

/** Accept: signed; the lesson becomes a new active lessons.md version. */
export const useAcceptCandidate = () =>
  useCandidateMutation<{ signedBy: string | null; text: string }>(
    (id) => `/api/learning/candidates/${id}/accept`,
    'POST',
  );

/** "Try on a PR…": saves the lessons.md draft with the lesson; a trial then runs it. */
export function useLessonDraft() {
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<LessonDraftResponse>(`/api/learning/candidates/${id}/draft`, { method: 'POST' }),
  });
}
