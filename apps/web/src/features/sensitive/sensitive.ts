// Sensitive files (S-11-T3): approve by hand and send back signed, on the version the page shows.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api.ts';
import type { PrView, SensitiveResult } from '@/lib/api-types.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys } from '@/features/pr/queries.ts';

const sensitivePath = (repo: string, number: string, action: 'approve' | 'send-back') =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}/sensitive/${action}`;

/** Merges what changed into the cached PR view and refreshes the rest (timeline, board). */
function useSettled(repo: string, number: string) {
  const queryClient = useQueryClient();
  return (result: SensitiveResult) => {
    queryClient.setQueryData<PrView>(prKeys.view(repo, number), (view) =>
      view ? { ...view, ...result } : view,
    );
    void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
    void queryClient.invalidateQueries({ queryKey: boardKeys.all });
  };
}

export function useApproveSensitive(repo: string, number: string) {
  const settled = useSettled(repo, number);
  return useMutation({
    mutationFn: (version: number) =>
      apiRequest<SensitiveResult>(sensitivePath(repo, number, 'approve'), {
        method: 'POST',
        body: { version },
      }),
    onSuccess: settled,
  });
}

export type SendBack = { version: number; comment: string; signedBy: string };

export function useSendBackSensitive(repo: string, number: string) {
  const settled = useSettled(repo, number);
  return useMutation({
    mutationFn: (input: SendBack) =>
      apiRequest<SensitiveResult>(sensitivePath(repo, number, 'send-back'), {
        method: 'POST',
        body: input,
      }),
    onSuccess: settled,
  });
}
