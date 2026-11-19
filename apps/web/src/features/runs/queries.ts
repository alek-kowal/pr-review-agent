import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { RunDetail } from '@/lib/api-types.ts';

export const runKeys = {
  detail: (runId: number) => ['run', runId] as const,
  transcript: (runId: number, sessionId: number) =>
    ['run', runId, 'transcript', sessionId] as const,
};

export const runDetailQuery = (runId: number) =>
  queryOptions({
    queryKey: runKeys.detail(runId),
    queryFn: ({ signal }) => apiGet<RunDetail>(`/api/runs/${runId}`, signal),
  });

export const transcriptQuery = (runId: number, sessionId: number) =>
  queryOptions({
    queryKey: runKeys.transcript(runId, sessionId),
    queryFn: ({ signal }) =>
      apiGet<unknown>(`/api/runs/${runId}/sessions/${sessionId}/transcript`, signal),
    // A finished session's log never changes.
    staleTime: Infinity,
  });
