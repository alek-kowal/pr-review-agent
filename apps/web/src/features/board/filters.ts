// S-17-T4: the board filters live in the page address (`/prs?person=&repo=&forks=&level=&drafts=`).
import { LEVEL_NUMBERS } from '@pra/core';

export type BoardFilters = {
  /** A Team member's GitHub login: PRs they authored or signed anything on. */
  person?: string | undefined;
  /** A repository slug. */
  repo?: string | undefined;
  /** Fork PRs are hidden unless the address says `all` or `only` (FORKS). */
  forks?: 'all' | 'only' | undefined;
  level?: number | undefined;
  drafts?: 'hide' | undefined;
};

export const FILTER_KEYS = ['person', 'repo', 'forks', 'level', 'drafts'] as const;

/** The panel filters behind the Filters button (Person stands on its own). */
export const PANEL_KEYS = ['repo', 'forks', 'level', 'drafts'] as const;

const text = (value: unknown): string | undefined => {
  // The router parses `?person=123` as a number; a login is still text.
  const s = typeof value === 'number' ? String(value) : value;
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
};

/**
 * Keeps only valid filters from the raw search, so a bad link shows the default board. A missing
 * or unknown `forks` (the old `forks=hide` too) is the default: forks hidden.
 */
export function parseBoardSearch(search: Record<string, unknown>): BoardFilters {
  const level = Number(search.level);
  return {
    person: text(search.person),
    repo: text(search.repo),
    forks: search.forks === 'all' || search.forks === 'only' ? search.forks : undefined,
    level: (LEVEL_NUMBERS as readonly number[]).includes(level) ? level : undefined,
    drafts: search.drafts === 'hide' ? 'hide' : undefined,
  };
}

/** The filters that are set, without the empty ones. */
export function setFilters(filters: BoardFilters): BoardFilters {
  return Object.fromEntries(
    FILTER_KEYS.filter((key) => filters[key] !== undefined).map((key) => [key, filters[key]]),
  ) as BoardFilters;
}

/** What `GET /api/board` gets for the address's `forks`; the API's own default lists every PR. */
const apiForks = (forks: BoardFilters['forks']): 'hide' | 'only' | undefined =>
  forks === undefined ? 'hide' : forks === 'only' ? 'only' : undefined;

/**
 * `?person=kasia&forks=hide&level=3` for `GET /api/board`. The board hides forks by default, so
 * the request says `forks=hide` unless the address asks for `all` (no param) or `only`.
 */
export function boardApiQuery(filters: BoardFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = key === 'forks' ? apiForks(filters.forks) : filters[key];
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** The filters a person set; the defaults (forks hidden) do not count. */
export const activeCount = (filters: BoardFilters, keys: readonly (keyof BoardFilters)[]) =>
  keys.filter((key) => filters[key] !== undefined).length;
