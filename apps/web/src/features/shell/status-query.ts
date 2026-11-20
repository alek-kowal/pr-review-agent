import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { GitHubMode, StatusResponse } from '@/lib/api-types.ts';

export const statusKeys = { all: ['status'] as const };

export const statusQuery = () =>
  queryOptions({
    queryKey: statusKeys.all,
    queryFn: ({ signal }) => apiGet<StatusResponse>('/api/status', signal),
  });

/**
 * How the app reaches GitHub (P-28), from the status; undefined while it loads. Without the App
 * (`token`, `anonymous`) nothing is written to GitHub.
 */
export function useGitHubMode(): GitHubMode | undefined {
  return useQuery(statusQuery()).data?.githubMode;
}

/** True when the app only reads GitHub: merge, push and autofix are off. */
export function useGitHubReadOnly(): boolean {
  const mode = useGitHubMode();
  return mode !== undefined && mode !== 'app';
}
