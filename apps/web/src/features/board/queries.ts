import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { BoardResponse } from '@/lib/api-types.ts';

export const boardKeys = { all: ['board'] as const };

export const boardQuery = () =>
  queryOptions({
    queryKey: boardKeys.all,
    queryFn: ({ signal }) => apiGet<BoardResponse>('/api/board', signal),
    // Live updates (`src/live`) invalidate it when a PR, run, finding or decision changes.
    refetchOnWindowFocus: true,
  });
