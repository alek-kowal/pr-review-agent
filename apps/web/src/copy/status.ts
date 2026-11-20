// The status chip in the top bar: the factory's state, today's spend, pause and budget.
import type { StatusResponse } from '@/lib/api-types.ts';
import { money, moneyOf, plural, spendHint } from './format.ts';

/** "$12.40 of $50.00", or "$12.40" without a budget. */
const spentOf = (s: Pick<StatusResponse, 'todaySpendUsd' | 'dailyBudgetUsd'>) =>
  s.dailyBudgetUsd === null ? money(s.todaySpendUsd) : moneyOf(s.todaySpendUsd, s.dailyBudgetUsd);

export const status = {
  label: 'Factory status',
  /** P-28: without the GitHub App the app only reads GitHub. */
  githubReadOnly: {
    label: 'Read-only: GitHub App not connected',
    merge: 'Merge in GitHub until the App is connected.',
    push: 'Push the patch by hand until the App is connected.',
    implement: 'The patch is made and can be downloaded, but not pushed.',
    autofix: 'Level 5 records what it would push in the shadow log and pushes nothing.',
  },
  /** How the agents reach the model (P-25): names only, never a value. */
  modelAuth: {
    label: 'Model access',
    modes: {
      subscription: 'Claude subscription',
      api_key: 'API key',
      none: 'Not configured',
    } satisfies Record<StatusResponse['modelAuth'], string>,
    hints: {
      subscription:
        'Agents run on CLAUDE_CODE_OAUTH_TOKEN. Costs are API-equivalent; the daily budget guards that number.',
      api_key: 'Agents run on ANTHROPIC_API_KEY, billed per token.',
      none: 'Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in .env and restart the api and the worker.',
    } satisfies Record<StatusResponse['modelAuth'], string>,
  },
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
  get spentHint() {
    return spendHint('Real spend only: what agent sessions cost since midnight.');
  },
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
