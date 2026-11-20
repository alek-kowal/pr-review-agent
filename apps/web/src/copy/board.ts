// Copy for the board (`/prs`).
import type { Lane } from '@pra/core';

export const board = {
  title: 'Pull requests',
  loading: 'Loading the board…',
  lanes: {
    not_reviewed: { name: 'Not reviewed', empty: 'No drafts or forks waiting.' },
    agents_working: { name: 'Agents working', empty: 'No agent is working.' },
    action_needed: { name: 'Action needed', empty: 'Nothing needs a person right now.' },
    ready_to_merge: { name: 'Ready to merge', empty: 'No PR is ready yet.' },
  } satisfies Record<Lane, { name: string; empty: string }>,
  count: (n: number) => (n === 1 ? '1 pull request' : `${n} pull requests`),
  drafts: (n: number) => (n === 1 ? '1 draft' : `${n} drafts`),
  number: (n: number) => `#${n}`,
  mergedOrClosed: 'Merged or closed in the last 7 days',
  mergedOrClosedColumns: { pullRequest: 'Pull request', author: 'Author', outcome: 'Outcome' },
  /** "3d" for a PR opened three days ago. */
  age: (ms: number) => {
    const minutes = Math.max(0, Math.floor(ms / 60_000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  },
  opened: (date: string) => `Opened ${date}`,
  /** Shown only when they differ from the default (FR-006). */
  level: (n: number) => `L${n}`,
  levelTitle: (n: number, repositoryDefault: number) =>
    `Review level ${n} (repository default: ${repositoryDefault})`,
  round: (n: number, max: number) => `round ${n} of ${max}`,
  fork: 'Fork',
  forkTitle: 'Fork: read-only review, started by hand',
  /** The filters above the board (S-17-T4). */
  filters: {
    person: 'Person',
    everyone: 'Everyone',
    searchPeople: 'Search people',
    noPerson: 'No one matches.',
    /** A login in the address that is not in Team (a removed member). */
    login: (login: string) => `@${login}`,
    button: 'Filters',
    buttonCount: (n: number) => `Filters · ${n}`,
    panelLabel: 'Board filters',
    repository: 'Repository',
    allRepositories: 'All',
    forks: 'Forks',
    forkOptions: { show: 'Show', hide: 'Hide', only: 'Only forks' },
    level: 'Review level',
    anyLevel: 'Any',
    hideDrafts: 'Hide drafts',
    clear: 'Clear filters',
    laneEmpty: 'Nothing matches the filters.',
  },
  /** Without the GitHub App (CONNECT): Poll now from the board's corner. */
  refresh: {
    label: 'GitHub refresh',
    button: 'Refresh from GitHub',
    refreshing: 'Refreshing…',
    never: 'Not polled yet',
    /** "Updated 3 min ago": when the last poll ended. */
    updated: (ms: number) => {
      const minutes = Math.max(0, Math.floor(ms / 60_000));
      if (minutes < 1) return 'Updated just now';
      if (minutes < 60) return `Updated ${minutes} min ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `Updated ${hours} h ago`;
      return `Updated ${Math.floor(hours / 24)} d ago`;
    },
    lastError: (reason: string) => `Last poll: ${reason}`,
    failedToQueue: (reason: string) => `Refresh failed: ${reason}`,
  },
  /** Copy for card badges, by reason code (`CARD_BADGES` in the api). */
  badges: {} as Record<string, (params: Record<string, unknown>) => string>,
};
