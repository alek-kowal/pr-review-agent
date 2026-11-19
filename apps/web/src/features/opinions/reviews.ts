// Saving drafted opinions as one signed review (S-08-T4 api).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api.ts';
import type { ReviewResponse } from '@/lib/api-types.ts';
import { applyResult } from '@/features/findings/decisions.ts';
import type { ReviewDraft } from './draft.ts';

export type SaveReviewInput = { draft: ReviewDraft; signedBy: string };

const prPath = (repo: string, number: string) =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;

export function useSaveReview(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ draft, signedBy }: SaveReviewInput) =>
      apiRequest<ReviewResponse>(`${prPath(repo, number)}/reviews`, {
        method: 'POST',
        body: {
          opinions: [...draft].map(([findingId, opinion]) => ({
            findingId,
            value: opinion.value,
            ...(opinion.comment.trim() ? { comment: opinion.comment.trim() } : {}),
          })),
          signedBy,
        },
      }),
    onSuccess: (result) => applyResult(queryClient, repo, number, result),
  });
}
