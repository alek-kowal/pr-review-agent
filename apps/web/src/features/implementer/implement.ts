// Implement with agent (S-13-T5): starting the implementer from the banner and raising the PR's
// level. Both refresh the PR view and the board so the banner and the lane follow.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LevelNumber } from '@pra/core';
import { apiRequest } from '@/lib/api.ts';
import type { ImplementResponse } from '@/lib/api-types.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys, prPath } from '@/features/pr/queries.ts';

function useRefreshPr(repo: string, number: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
    void queryClient.invalidateQueries({ queryKey: boardKeys.all });
  };
}

/** `POST .../implement`: signed; the run takes every open finding decided Implement. */
export function useImplement(repo: string, number: string) {
  const refresh = useRefreshPr(repo, number);
  return useMutation({
    mutationFn: (signedBy: string) =>
      apiRequest<ImplementResponse>(`${prPath(repo, number)}/implement`, {
        method: 'POST',
        body: { signedBy },
      }),
    onSuccess: refresh,
  });
}

/** `PUT .../level`: the PR's own level, unsigned (recorded "by hand"). */
export function useSetPrLevel(repo: string, number: string) {
  const refresh = useRefreshPr(repo, number);
  return useMutation({
    mutationFn: (level: LevelNumber | null) =>
      apiRequest<unknown>(`${prPath(repo, number)}/level`, { method: 'PUT', body: { level } }),
    onSuccess: refresh,
  });
}
