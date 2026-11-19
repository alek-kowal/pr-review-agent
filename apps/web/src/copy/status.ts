// The status chip in the top bar: the factory's state, today's spend, pause and budget.
import type { StatusResponse } from '@/lib/api-types.ts';
import { money, plural } from './format.ts';

/** "$12.40 of $50.00", or "$12.40" without a budget. */
const spentOf = (s: Pick<StatusResponse, 'todaySpendUsd' | 'dailyBudgetUsd'>) =>
  s.dailyBudgetUsd === null
    ? money(s.todaySpendUsd)
    : `${money(s.todaySpendUsd)} of ${money(s.dailyBudgetUsd)}`;

export const status = {
  label: 'Factory status',
  spentOf,
  /** The chip's text by status state. */
  states: {
    running: (s: StatusResponse) => `Running · ${spentOf(s)} today`,
    paused: (s: StatusResponse) => {
      const by = s.pausedBy ? `Paused by ${s.pausedBy.name}` : 'Paused';
      return s.pausedReason ? `${by} (${s.pausedReason})` : by;
    },
    budget_reached: (s: StatusResponse) => `Daily budget reached · ${spentOf(s)}`,
  } satisfies Record<StatusResponse['state'], (s: StatusResponse) => string>,
  spentToday: 'Spent today',
  spentHint: 'Real spend only: what agent sessions cost since midnight.',
  spentPercent: 'Share of the daily budget spent today',
  queued: (count: number) => `${plural(count, 'round')} queued`,
  openActivity: 'Open Activity',
  pause: {
    label: 'Pause the factory',
    placeholder: 'Reason, e.g. release freeze',
    hint: 'Running rounds finish. New rounds wait in the queue until someone resumes.',
    button: 'Pause',
    reasonRequired: 'Give a reason, so the team knows why rounds are waiting.',
    done: 'Factory paused',
    doneDetail: (name: string) => `New rounds wait in the queue. Signed by ${name}.`,
  },
  paused: {
    by: (name: string | null) => (name ? `Paused by ${name}` : 'Paused'),
    resume: 'Resume',
    done: 'Factory resumed',
    doneDetail: (name: string) => `Queued rounds are starting. Signed by ${name}.`,
  },
  budgetUsedUp: 'Budget used up. Raise it, or wait until midnight.',
  signNote: 'Pause, resume and budget changes are signed and logged.',
  budget: {
    label: 'Daily budget $',
    save: 'Save budget',
    invalid: 'Enter an amount above 0.',
    unchanged: 'Change the amount first.',
    done: (amount: string) => `Daily budget is now ${amount}`,
    doneDetail: (name: string) => `Signed by ${name}.`,
  },
  settingsLink: 'Budget & status settings',
};
