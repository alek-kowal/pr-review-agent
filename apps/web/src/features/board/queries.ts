import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { BoardResponse } from '@/lib/api-types.ts';

/** The board refetches this often, and when the window gets focus. SSE replaces it in S-03. */
export const BOARD_POLL_MS = 10_000;

export const boardKeys = { all: ['board'] as const };

export const boardQuery = () =>
  queryOptions({
    queryKey: boardKeys.all,
    queryFn: ({ signal }) => apiGet<BoardResponse>('/api/board', signal),
    refetchInterval: BOARD_POLL_MS,
    refetchOnWindowFocus: true,
  });
