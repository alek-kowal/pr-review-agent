import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { StatusResponse } from '@/lib/api-types.ts';

export const statusKeys = { all: ['status'] as const };

export const statusQuery = () =>
  queryOptions({
    queryKey: statusKeys.all,
    queryFn: ({ signal }) => apiGet<StatusResponse>('/api/status', signal),
  });
