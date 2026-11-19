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
  /** Copy for card badges, by reason code (`CARD_BADGES` in the api). */
  badges: {} as Record<string, (params: Record<string, unknown>) => string>,
};
