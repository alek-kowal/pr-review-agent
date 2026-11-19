// Copy for the Activity page: what agents are doing now.
import { money, plural } from './format.ts';

export const activity = {
  title: 'Activity',
  loading: 'Loading what agents are doing…',
  inProgress: {
    title: 'In progress',
    empty: 'No agent is working and nothing is queued.',
    columns: {
      pullRequest: 'Pull request',
      run: 'Run',
      stage: 'Current stage',
      started: 'Started',
      cost: 'Cost so far',
      actions: 'Actions',
    },
    queued: 'Queued',
    /** Why a run waits (S-10), by reason code; `by` is the pauser's name. */
    waits: {
      paused: (p: { by: string; note: string | null }) =>
        `Queued: paused by ${p.by}${p.note ? ` (${p.note})` : ''}`,
      budget_reached: (p: { spentUsd: number; budgetUsd: number }) =>
        `Queued: daily budget reached (${money(p.spentUsd)} of ${money(p.budgetUsd)})`,
      slots_busy: (p: { slots: number; prs: number[] }) =>
        `Queued: ${plural(p.slots, 'agent slot')} busy${p.prs.length ? ` (${p.prs.map((n) => `#${n}`).join(', ')})` : ''}`,
    },
    /** Between two stages, before the next one has started. */
    starting: 'Starting',
    notStarted: 'Not started',
  },
};
