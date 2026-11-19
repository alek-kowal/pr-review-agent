import { infiniteQueryOptions } from '@tanstack/react-query';
import { apiGet } from '@/lib/api.ts';
import type { AuditResponse } from '@/lib/api-types.ts';

/** The Audit log's filters, kept in the URL. `who` is `bot`, `hand` or a member id. */
export type AuditSearch = {
  q?: string;
  area?: string;
  who?: string;
  /** Local dates (`YYYY-MM-DD`), both days included. */
  from?: string;
  to?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;
const date = (value: unknown) =>
  typeof value === 'string' && DATE.test(value) ? value : undefined;

export function validateAuditSearch(search: Record<string, unknown>): AuditSearch {
  return {
    q: text(search.q),
    area: text(search.area),
    who: text(search.who),
    from: date(search.from),
    to: date(search.to),
  };
}

/** Local midnight of a `YYYY-MM-DD` day, `days` later, as an ISO instant. */
function localMidnight(day: string, days = 0): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d + days).toISOString();
}

/** `GET /api/audit` with the filters: the To day is included, so `to` is the next midnight. */
export function auditApiPath(search: AuditSearch, cursor?: string): string {
  const query = new URLSearchParams();
  if (search.q) query.set('q', search.q);
  if (search.area) query.set('area', search.area);
  if (search.who) query.set('actor', search.who);
  if (search.from) query.set('from', localMidnight(search.from));
  if (search.to) query.set('to', localMidnight(search.to, 1));
  if (cursor) query.set('cursor', cursor);
  const qs = query.toString();
  return qs ? `/api/audit?${qs}` : '/api/audit';
}

export const auditQuery = (search: AuditSearch) =>
  infiniteQueryOptions({
    queryKey: ['audit', search] as const,
    queryFn: ({ pageParam, signal }) =>
      apiGet<AuditResponse>(auditApiPath(search, pageParam), signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
