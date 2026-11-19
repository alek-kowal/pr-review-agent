import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { BoardResponse } from '@/lib/api-types.ts';
import { boardApiQuery, setFilters, type BoardFilters } from './filters.ts';

export const boardKeys = { all: ['board'] as const };

export const boardQuery = (filters: BoardFilters = {}) =>
  queryOptions({
    queryKey: [...boardKeys.all, setFilters(filters)] as const,
    queryFn: ({ signal }) => apiGet<BoardResponse>(`/api/board${boardApiQuery(filters)}`, signal),
    // Live updates (`src/live`) invalidate it when a PR, run, finding or decision changes.
    refetchOnWindowFocus: true,
  });
