// Merge from the app (S-12-T4): the signed squash merge of a Ready to merge PR.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys, prPath } from '@/features/pr/queries.ts';
import { apiRequest } from '@/lib/api.ts';
import type { MergeResponse } from '@/lib/api-types.ts';

export type MergeInput = { typedNumber: number; signedBy: string };

/**
 * Posts the merge. Success or not, the PR view and the board are fetched again: a refusal can
 * still have stored fresh CI and reviews, or found the head moved.
 */
export function useMergePr(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MergeInput) =>
      apiRequest<MergeResponse>(`${prPath(repo, number)}/merge`, { method: 'POST', body: input }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
