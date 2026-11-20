import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { instructionKeys } from '@/features/instructions/queries.ts';
import { apiGet, apiRequest } from '@/lib/api.ts';
import type {
  PipelineResponse,
  StageFilesSaveBody,
  StageFilesView,
  PipelineStageKey,
} from '@/lib/api-types.ts';

export const pipelineKeys = {
  all: ['pipeline'] as const,
  scope: (repository: string | null) => ['pipeline', repository] as const,
};

/**
 * The pipeline: every stage with its model, tools and limits, and the instruction files each stage
 * reads at one scope (Global when `repository` is null, else that repository's).
 */
export const pipelineQuery = (repository: string | null = null) =>
  queryOptions({
    queryKey: pipelineKeys.scope(repository),
    queryFn: ({ signal }) =>
      apiGet<PipelineResponse>(
        repository ? `/api/pipeline?repository=${encodeURIComponent(repository)}` : '/api/pipeline',
        signal,
      ),
  });

/** Saves one stage's files at one scope (signed). The pipeline and the instructions refetch. */
export function useStageFilesSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stage, body }: { stage: PipelineStageKey; body: StageFilesSaveBody }) =>
      apiRequest<{ stage: StageFilesView }>(`/api/settings/stage-files/${stage}`, {
        method: 'PUT',
        body,
      }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pipelineKeys.all }),
        queryClient.invalidateQueries({ queryKey: instructionKeys.all }),
      ]),
  });
}
