import type { LevelNumber } from '@pra/core';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type { LevelsResponse, LevelView } from '@/lib/api-types.ts';

const PATH = '/api/settings/levels';
export const levelsKeys = { all: ['settings', 'levels'] as const };

export const levelsQuery = () =>
  queryOptions({
    queryKey: levelsKeys.all,
    queryFn: ({ signal }) => apiGet<LevelsResponse>(PATH, signal),
  });

/**
 * A level's own values as `PUT /api/settings/levels/:n` takes them: every field and role, with
 * `inherit` where the level takes the value from below.
 */
export type LevelValuesBody = Record<string, unknown> & {
  models: Record<string, string>;
};

/** Saves a level's own values, signed; every level refetches (higher levels inherit from it). */
export function useLevelChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: {
      level: LevelNumber;
      before: LevelView['own'];
      values: LevelValuesBody;
      signedBy: string;
    }) =>
      apiRequest<{ level: LevelView }>(`${PATH}/${change.level}`, {
        method: 'PUT',
        body: { values: change.values, before: change.before, signedBy: change.signedBy },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}

/** Saves the default level for repositories without their own, signed. */
export function useDefaultLevelChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: { before: LevelNumber; after: LevelNumber; signedBy: string }) =>
      apiRequest<{ defaultLevel: LevelNumber }>('/api/settings/default-level', {
        method: 'PUT',
        body: {
          defaultLevel: change.after,
          before: { defaultLevel: change.before },
          signedBy: change.signedBy,
        },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}
