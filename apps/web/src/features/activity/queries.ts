import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { InProgressResponse } from '@/lib/api-types.ts';

export const activityKeys = {
  all: ['activity'] as const,
  inProgress: ['activity', 'in-progress'] as const,
};

export const inProgressQuery = () =>
  queryOptions({
    queryKey: activityKeys.inProgress,
    queryFn: ({ signal }) => apiGet<InProgressResponse>('/api/activity/in-progress', signal),
  });
