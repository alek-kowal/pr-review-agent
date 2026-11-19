import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import {
  isActiveStatus,
  type FindingsResponse,
  type PrListResponse,
  type PrView,
  type RepositoriesResponse,
} from '@/lib/api-types.ts';

/** Pages poll this often while a round is active. Live updates (SSE) replace it in S-03. */
export const ACTIVE_POLL_MS = 5_000;

export const prKeys = {
  repositories: ['repositories'] as const,
  list: (repo: string | undefined) => ['prs', { repo: repo ?? null }] as const,
  view: (repo: string, number: string) => ['pr', repo, number] as const,
  findings: (repo: string, number: string) => ['pr', repo, number, 'findings'] as const,
};

const path = (repo: string, number: string) =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;

export const repositoriesQuery = () =>
  queryOptions({
    queryKey: prKeys.repositories,
    queryFn: ({ signal }) => apiGet<RepositoriesResponse>('/api/repositories', signal),
  });

export const prListQuery = (repo: string | undefined) =>
  queryOptions({
    queryKey: prKeys.list(repo),
    queryFn: ({ signal }) =>
      apiGet<PrListResponse>(
        repo ? `/api/prs?repo=${encodeURIComponent(repo)}` : '/api/prs',
        signal,
      ),
    refetchInterval: (query) =>
      query.state.data?.pullRequests.some((pr) => isActiveStatus(pr.latestRoundStatus))
        ? ACTIVE_POLL_MS
        : false,
  });

export const prViewQuery = (repo: string, number: string) =>
  queryOptions({
    queryKey: prKeys.view(repo, number),
    queryFn: ({ signal }) => apiGet<PrView>(path(repo, number), signal),
    refetchInterval: (query) =>
      isActiveStatus(query.state.data?.latestRound?.status) ? ACTIVE_POLL_MS : false,
  });

export const findingsQuery = (repo: string, number: string, active: boolean) =>
  queryOptions({
    queryKey: prKeys.findings(repo, number),
    queryFn: ({ signal }) => apiGet<FindingsResponse>(`${path(repo, number)}/findings`, signal),
    refetchInterval: active ? ACTIVE_POLL_MS : false,
  });
