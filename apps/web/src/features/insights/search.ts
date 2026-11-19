// Insights filters live in the URL: range (14 or 30 days), PR author and repository.
import type { Range } from './types.ts';

export const DEFAULT_RANGE: Range = 30;
export const RANGES: readonly Range[] = [14, 30];

export type InsightsSearch = {
  range?: Range | undefined;
  author?: string | undefined;
  repo?: string | undefined;
};

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);

/** Keeps known values only; the root passes the raw URL search on, so bad ones are cleared. */
export function validateInsightsSearch(search: Record<string, unknown>): InsightsSearch {
  const range = Number(search.range);
  return {
    range: range === 14 || range === 30 ? range : undefined,
    author: text(search.author),
    repo: text(search.repo),
  };
}

/** An api path with the filters that are set as its query string. */
export function apiPath(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
