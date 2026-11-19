import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import { isActiveStatus, type FindingsResponse, type PrView } from '@/lib/api-types.ts';

/** Pages poll this often while a round is active. Live updates (SSE) replace it in S-03. */
export const ACTIVE_POLL_MS = 5_000;

export const prKeys = {
  view: (repo: string, number: string) => ['pr', repo, number] as const,
  findings: (repo: string, number: string) => ['pr', repo, number, 'findings'] as const,
};

const path = (repo: string, number: string) =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;

export const prViewQuery = (repo: string, number: string) =>
  queryOptions({
    queryKey: prKeys.view(repo, number),
    queryFn: ({ signal }) => apiGet<PrView>(path(repo, number), signal),
    // Poll while agents work, so the banner and checklist follow the round.
    refetchInterval: (query) =>
      isActiveStatus(query.state.data?.latestRound?.status) ||
      query.state.data?.nextStep.lane === 'agents_working'
        ? ACTIVE_POLL_MS
        : false,
  });

export const findingsQuery = (repo: string, number: string, active: boolean) =>
  queryOptions({
    queryKey: prKeys.findings(repo, number),
    queryFn: ({ signal }) => apiGet<FindingsResponse>(`${path(repo, number)}/findings`, signal),
    refetchInterval: active ? ACTIVE_POLL_MS : false,
  });
