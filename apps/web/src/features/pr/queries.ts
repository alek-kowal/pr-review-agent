import { queryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { FindingsResponse, PrView, TimelineResponse } from '@/lib/api-types.ts';

// No polling: live updates (`src/live`) invalidate these keys when the PR's rows change.

export const prKeys = {
  view: (repo: string, number: string) => ['pr', repo, number] as const,
  findings: (repo: string, number: string) => ['pr', repo, number, 'findings'] as const,
  timeline: (repo: string, number: string) => ['pr', repo, number, 'timeline'] as const,
};

export const prPath = (repo: string, number: string) =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;

export const prViewQuery = (repo: string, number: string) =>
  queryOptions({
    queryKey: prKeys.view(repo, number),
    queryFn: ({ signal }) => apiGet<PrView>(prPath(repo, number), signal),
  });

export const findingsQuery = (repo: string, number: string) =>
  queryOptions({
    queryKey: prKeys.findings(repo, number),
    queryFn: ({ signal }) => apiGet<FindingsResponse>(`${prPath(repo, number)}/findings`, signal),
  });

export const timelineQuery = (repo: string, number: string) =>
  queryOptions({
    queryKey: prKeys.timeline(repo, number),
    queryFn: ({ signal }) => apiGet<TimelineResponse>(`${prPath(repo, number)}/timeline`, signal),
  });
