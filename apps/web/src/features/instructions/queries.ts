import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type {
  InstructionDetailResponse,
  InstructionsListResponse,
  NewInstructionFileBody,
} from '@/lib/api-types.ts';

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
  /** Discard draft (unsigned); null when the file's only version went, and the file with it. */
  | { kind: 'discard' }
  | {
      kind: 'activate';
      versionId: number;
      /** The active version number the signer saw. */
      activeVersion: number | null;
      signedBy: string;
    };

/**
 * Saves or discards the draft (unsigned, "by hand") or makes a version active (signed). The file
 * and the list refetch after it.
 */
export function useInstructionChange(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Change): Promise<InstructionDetailResponse | null> => {
      if (change.kind === 'draft') {
        return apiRequest<InstructionDetailResponse>(`/api/instructions/${id}/draft`, {
          method: 'PUT',
          body: { content: change.content, note: change.note },
        });
      }
      if (change.kind === 'discard') {
        // 204 (no body) when the file went with its only version.
        return apiRequest<InstructionDetailResponse | undefined>(`/api/instructions/${id}/draft`, {
          method: 'DELETE',
        }).then((detail) => detail ?? null);
      }
      return apiRequest<InstructionDetailResponse>(`/api/instructions/${id}/activate`, {
        method: 'POST',
        body: {
          versionId: change.versionId,
          activeVersion: change.activeVersion,
          signedBy: change.signedBy,
        },
      });
    },
    onSuccess: (detail) => {
      if (detail) queryClient.setQueryData(instructionKeys.one(id), detail);
    },
    // A stale or missing version: show what is stored now, so a retry starts from it.
    onError: () => queryClient.invalidateQueries({ queryKey: instructionKeys.one(id) }),
    onSettled: () => refreshLists(queryClient),
  });
}

/**
 * The list and the pipeline (its versions and options) refetch; the file itself is set from the
 * answer, so a discarded file is not fetched again.
 */
const refreshLists = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: instructionKeys.all, exact: true }),
    queryClient.invalidateQueries({ queryKey: ['pipeline'] }),
  ]);

/** New file: creates it with version 1 as an unsigned draft. */
export function useCreateInstructionFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NewInstructionFileBody) =>
      apiRequest<InstructionDetailResponse>('/api/instructions', { method: 'POST', body }),
    onSuccess: (detail) => queryClient.setQueryData(instructionKeys.one(detail.file.id), detail),
    onSettled: () => refreshLists(queryClient),
  });
}
