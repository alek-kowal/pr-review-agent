import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { PipelineResponse } from '@/lib/api-types.ts';

/** The read-only pipeline: every stage with its model, tools, instructions and limits. */
export const pipelineQuery = () =>
  queryOptions({
    queryKey: ['pipeline'] as const,
    queryFn: ({ signal }) => apiGet<PipelineResponse>('/api/pipeline', signal),
  });
