import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type { InstructionDetailResponse, InstructionsListResponse } from '@/lib/api-types.ts';

export const instructionKeys = {
  all: ['instructions'] as const,
  one: (id: number) => ['instructions', id] as const,
};

/** Every instruction file with its active version and draft. */
export const instructionsQuery = () =>
  queryOptions({
    queryKey: instructionKeys.all,
    queryFn: ({ signal }) => apiGet<InstructionsListResponse>('/api/instructions', signal),
  });

/** One file with its versions, newest first. */
export const instructionQuery = (id: number) =>
  queryOptions({
    queryKey: instructionKeys.one(id),
    queryFn: ({ signal }) => apiGet<InstructionDetailResponse>(`/api/instructions/${id}`, signal),
  });

type Change =
  | { kind: 'draft'; content: string; note: string | null }
  | {
      kind: 'activate' | 'rollback';
      versionId: number;
      /** The active version number the signer saw. */
      activeVersion: number | null;
      signedBy: string;
    };

/**
 * Saves the draft (unsigned, "by hand") or activates or rolls back a version (signed). The file
 * and the list refetch after it.
 */
export function useInstructionChange(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) =>
      change.kind === 'draft'
        ? apiRequest<InstructionDetailResponse>(`/api/instructions/${id}/draft`, {
            method: 'PUT',
            body: { content: change.content, note: change.note },
          })
        : apiRequest<InstructionDetailResponse>(`/api/instructions/${id}/${change.kind}`, {
            method: 'POST',
            body: {
              versionId: change.versionId,
              activeVersion: change.activeVersion,
              signedBy: change.signedBy,
            },
          }),
    onSuccess: (detail) => queryClient.setQueryData(instructionKeys.one(id), detail),
    onSettled: () => queryClient.invalidateQueries({ queryKey: instructionKeys.all }),
  });
}
