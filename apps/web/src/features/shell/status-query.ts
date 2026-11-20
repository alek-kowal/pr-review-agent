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
 * (`token`, `anonymous`) nothing is written to GitHub. A status that failed reads as `app`, the
 * mode pages had before P-28: the API still refuses what GitHub does not allow.
 */
export function useGitHubMode(): GitHubMode | undefined {
  const status = useQuery(statusQuery());
  return status.data?.githubMode ?? (status.isFetched ? 'app' : undefined);
}

/** True when the app only reads GitHub: merge, push and autofix are off. */
export function useGitHubReadOnly(): boolean {
  const mode = useGitHubMode();
  return mode !== undefined && mode !== 'app';
}
