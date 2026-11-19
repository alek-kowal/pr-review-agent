// Settings → General → Budget & status (S-10-T5).
import { money, plural, spendHint } from './format.ts';

export const budget = {
  title: 'Budget & status',
  affects: 'whether new rounds start at all, and how much the whole factory may spend per day.',
  loading: 'Loading the status…',
  states: { running: 'Running', paused: 'Paused', budget_reached: 'Budget reached' },
  status: {
    title: 'Status',
    pausedBy: (name: string | null) => (name ? `Paused by ${name}` : 'Paused'),
    pausedHint: 'New rounds wait in the queue. Rounds that were running finish normally.',
    resume: 'Resume…',
    resumeTitle: 'Resume the factory',
    resumeDescription: 'Queued rounds start right away.',
    resumeConfirm: 'Resume',
    pause: 'Pause the factory',
    pauseHint:
      'Use it for a release freeze or when costs look wrong. Rounds that are running finish; new ones wait in the queue.',
    pausePlaceholder: 'Reason, e.g. release freeze',
    pauseButton: 'Pause…',
    pauseTitle: 'Pause the factory',
    pauseDescription: 'New rounds will wait in the queue until someone resumes.',
    pauseConfirm: 'Pause',
    reasonFirst: 'Give a reason first, so the team knows why rounds are waiting.',
    field: 'Status',
    running: 'Running',
    pausedValue: (reason: string) => `Paused: ${reason}`,
  },
  spend: {
    title: 'Budget',
    spentToday: 'Spent today',
    get spentHint() {
      return spendHint('Real spend only. Resets at midnight in the time zone below.');
    },
    of: (amount: number) => `of ${money(amount)}`,
    noBudget: 'no daily budget',
    insightsLink: 'Spend in Insights',
    timeZone: (zone: string) => `Days start at midnight, ${zone}.`,
    dailyBudget: 'Daily budget',
    dailyBudgetHint:
      'When the spend reaches it, new rounds wait in the queue. It is checked before every agent session. Leave it empty for no budget.',
    perDay: 'per day',
    invalid: 'Enter an amount above 0, or leave it empty.',
  },
  queue: {
    title: 'Queue',
    slots: 'Agent slots',
    slotsHint:
      'How many rounds may run at the same time. More slots finish sooner and spend the budget faster.',
    slotsInvalid: (max: number) => `Enter a whole number from 1 to ${max}.`,
    waiting: 'Waiting now',
    queued: (count: number) => `${plural(count, 'round')} queued`,
    nothing: 'Nothing is queued.',
    openActivity: 'Open Activity',
  },
  save: {
    title: 'Save budget settings',
    noBudget: 'No budget',
  },
};
