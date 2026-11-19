// The Patch tab (S-13-T6): one patch revision with its files, and the unsigned edits on it.
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type { ImplementResponse, PatchDetail, PatchFileView } from '@/lib/api-types.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys } from '@/features/pr/queries.ts';

/**
 * Keyed by the patch check's version and kept outside the PR's keys: live updates refresh the PR
 * view (which carries the newest summary), while the tab keeps showing what the reader opened
 * until they pick "View new results".
 */
export const patchKeys = {
  detail: (id: number, checkVersion: number) => ['patch', id, checkVersion] as const,
};

export const patchQuery = (id: number, checkVersion: number) =>
  queryOptions({
    queryKey: patchKeys.detail(id, checkVersion),
    queryFn: ({ signal }) => apiGet<PatchDetail>(`/api/patches/${id}`, signal),
  });

/** What an edit or a revert names: the file as the page saw it, so a stale page gets 409. */
const target = (detail: PatchDetail, file: PatchFileView) => ({
  path: file.path,
  revision: detail.patch.revision,
  blobKey: file.blobKey,
});

function usePatchChange<Input>(
  repo: string,
  number: string,
  detail: PatchDetail,
  request: (input: Input) => Promise<PatchDetail>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (next) => {
      queryClient.setQueryData(patchKeys.detail(detail.patch.id, detail.patch.checkVersion), next);
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
    },
  });
}

/** `PUT /api/patches/:id/files`: the file's new content, by hand. */
export function useEditPatchFile(repo: string, number: string, detail: PatchDetail) {
  return usePatchChange(repo, number, detail, (input: { file: PatchFileView; content: string }) =>
    apiRequest<PatchDetail>(`/api/patches/${detail.patch.id}/files`, {
      method: 'PUT',
      body: { ...target(detail, input.file), content: input.content },
    }),
  );
}

/** `POST /api/patches/:id/files/revert`: the file back to the reviewed version. */
export function useRevertPatchFile(repo: string, number: string, detail: PatchDetail) {
  return usePatchChange(repo, number, detail, (file: PatchFileView) =>
    apiRequest<PatchDetail>(`/api/patches/${detail.patch.id}/files/revert`, {
      method: 'POST',
      body: target(detail, file),
    }),
  );
}

export type PushInput = { typedNumber: number; signedBy: string };

/**
 * `POST /api/patches/:id/push` (S-14-T4): queues the signed push. Success or not, the PR view and
 * the board are fetched again: a refusal can mean the head moved or the patch changed.
 */
export function usePushPatch(repo: string, number: string, patchId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PushInput) =>
      apiRequest<{ queued: true }>(`/api/patches/${patchId}/push`, { method: 'POST', body: input }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}

/** `POST /api/patches/:id/revise`: a new implementer run from this revision and a note. */
export function useRevisePatch(repo: string, number: string, patchId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) =>
      apiRequest<ImplementResponse>(`/api/patches/${patchId}/revise`, {
        method: 'POST',
        body: { note },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      void queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
