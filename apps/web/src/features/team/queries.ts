import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { TeamResponse } from '@/lib/api-types.ts';

export const teamKeys = {
  all: ['team'] as const,
};

/** Active Team members, the names every signature field offers. */
export const teamQuery = () =>
  queryOptions({
    queryKey: teamKeys.all,
    queryFn: ({ signal }) => apiGet<TeamResponse>('/api/team', signal),
  });
