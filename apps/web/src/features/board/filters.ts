// S-17-T4: the board filters live in the page address (`/prs?person=&repo=&forks=&level=&drafts=`).
import { LEVEL_NUMBERS } from '@pra/core';

export type BoardFilters = {
  /** A Team member's GitHub login: PRs they authored or signed anything on. */
  person?: string | undefined;
  /** A repository slug. */
  repo?: string | undefined;
  forks?: 'hide' | 'only' | undefined;
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

/** Keeps only valid filters from the raw search, so a bad link shows the whole board. */
export function parseBoardSearch(search: Record<string, unknown>): BoardFilters {
  const level = Number(search.level);
  return {
    person: text(search.person),
    repo: text(search.repo),
    forks: search.forks === 'hide' || search.forks === 'only' ? search.forks : undefined,
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

/** `?person=kasia&level=3` for `GET /api/board`; empty when nothing is filtered. */
export function boardApiQuery(filters: BoardFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const activeCount = (filters: BoardFilters, keys: readonly (keyof BoardFilters)[]) =>
  keys.filter((key) => filters[key] !== undefined).length;
