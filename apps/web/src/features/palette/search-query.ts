import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { SearchResponse } from '@/lib/api-types.ts';

/** `GET /api/search?q=`: PRs by number, title words and author (S-17-T5). */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ['search', q] as const,
    queryFn: ({ signal }) =>
      apiGet<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, signal),
    enabled: q.trim() !== '',
    staleTime: 10_000,
  });
