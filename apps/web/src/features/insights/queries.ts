import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { RepositoriesResponse } from '@/lib/api-types.ts';
import { apiQuery } from './search.ts';
import type {
  CostResponse,
  OverviewResponse,
  QualityResponse,
  Range,
  TrustResponse,
} from './types.ts';

export const insightsKeys = { all: ['insights'] as const };

type Scope = { range: Range; repo?: string | undefined };

export const overviewQuery = (scope: Scope & { author?: string | undefined }) =>
  queryOptions({
    queryKey: [...insightsKeys.all, 'overview', scope],
    queryFn: ({ signal }) =>
      apiGet<OverviewResponse>(`/api/insights/overview?${apiQuery(scope)}`, signal),
  });

export const costQuery = (scope: Scope) =>
  queryOptions({
    queryKey: [...insightsKeys.all, 'cost', scope],
    queryFn: ({ signal }) => apiGet<CostResponse>(`/api/insights/cost?${apiQuery(scope)}`, signal),
  });

export const qualityQuery = (scope: Scope) =>
  queryOptions({
    queryKey: [...insightsKeys.all, 'quality', scope],
    queryFn: ({ signal }) =>
      apiGet<QualityResponse>(`/api/insights/quality?${apiQuery(scope)}`, signal),
  });

export const trustQuery = (scope: { repo?: string | undefined }) =>
  queryOptions({
    queryKey: [...insightsKeys.all, 'trust', scope],
    queryFn: ({ signal }) =>
      apiGet<TrustResponse>(`/api/insights/trust?${apiQuery(scope)}`, signal),
  });

/** Connected repositories, for the repository filter. */
export const repositoryOptionsQuery = () =>
  queryOptions({
    queryKey: ['repositories'],
    queryFn: ({ signal }) => apiGet<RepositoriesResponse>('/api/repositories', signal),
    staleTime: 60_000,
  });
