// Copy for alerts (S-18): Activity → Alerts, the board strip and card bell, the PR banner line,
// the status chip and the timeline. Title, next step and end note arrive as reason codes.
import { API_EQUIVALENT, duration, isApiEquivalent, money, moneyOf, plural } from './format.ts';

type Params = Record<string, unknown>;
/** Stage and failure names, passed in by the caller (they live in `copy.stages` and `copy.reasons`). */
export type AlertNames = { stage: (key: string) => string; reason: (code: string) => string };

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const s = (value: unknown): string => String(value ?? '');

/** The problem, in one sentence, by title code. */
const titles: Record<string, (p: Params, c: AlertNames) => string> = {
  alert_failed: (p, c) =>
    p.errorCode === 'stage_timeout' && p.timeoutMinutes
      ? `${c.stage(s(p.stage))} stage timed out after ${n(p.timeoutMinutes)} min on #${n(p.prNumber)}`
      : `${c.stage(s(p.stage))} stage failed on #${n(p.prNumber)}: ${c.reason(s(p.errorCode))}`,
  alert_rounds: (p) =>
    `Automatic rounds used (${n(p.max)} of ${n(p.max)}) on #${n(p.prNumber)}, a fix is still open`,
  alert_cost: (p) =>
    `#${n(p.prNumber)} has cost ${money(p.spentUsd)}, above the ${money(p.maxUsd)} alert threshold`,
  alert_budget: (p) =>
    n(p.percent) >= 100
      ? `Daily budget reached: ${moneyOf(p.spentUsd, p.budgetUsd)}`
      : `Daily budget ${n(p.percent)}% used: ${moneyOf(p.spentUsd, p.budgetUsd)}`,
};

/** A short name for a pill on the board strip. */
const shorts: Record<string, (p: Params) => string> = {
  alert_failed: () => 'Stage failed',
  alert_rounds: (p) => `Rounds used ${n(p.max)} of ${n(p.max)}`,
  alert_cost: (p) => `Cost ${money(p.spentUsd)}`,
  alert_budget: (p) => (n(p.percent) >= 100 ? 'Budget reached' : `Budget ${n(p.percent)}%`),
};

const nextSteps: Record<string, (p: Params, c: AlertNames) => string> = {
  alert_next_retry: (p, c) => `Retry from ${c.stage(s(p.stage))}`,
  alert_next_start_review: () => 'Start review',
  alert_next_split: () => 'Check whether the PR should be split',
  alert_next_budget: () => 'Pause, raise the budget or wait until midnight',
};

const endNotes: Record<string, string> = {
  alert_end_retried: 'A retry or a new review started',
  alert_end_new_review: 'A new review started',
  alert_end_below_threshold: 'Spend is below the threshold again',
  alert_end_midnight: 'Spend reset at midnight',
  alert_end_pr_closed: 'The PR was closed',
};

type Delivery = { status: string; taskId: string | null; toGeneralTask: boolean };
type AlertReason = { code: string; params: Params };

/** A stored title (reason code JSON) as a sentence; empty when it is not one. */
function titleOf(value: unknown, c: AlertNames): string {
  if (!value || typeof value !== 'object') return '';
  const r = value as Partial<AlertReason>;
  return titles[s(r.code)]?.(r.params ?? {}, c) ?? `Alert ${s(r.code)}`;
}

export const alerts = {
  title: (r: AlertReason, c: AlertNames) => titleOf(r, c),
  short: (r: AlertReason) => shorts[r.code]?.(r.params) ?? 'Alert',
  nextStep: (r: AlertReason, c: AlertNames) => nextSteps[r.code]?.(r.params, c) ?? '',
  endNote: (r: { code: string } | null) => (r ? (endNotes[r.code] ?? '') : ''),
  /** Where the ClickUp comment went, or why it did not. */
  delivery: (d: Delivery) => {
    const task = d.taskId
      ? `ClickUp ${d.taskId}${d.toGeneralTask ? ' (general alerts task)' : ''}`
      : 'ClickUp';
    switch (d.status) {
      case 'sent':
        return `Posted to ${task}`;
      case 'pending':
        return `Posting to ${task}`;
      case 'not_configured':
        return 'Not sent: ClickUp not configured';
      default:
        return `Could not post to ${task}; trying again`;
    }
  },
  /** "5 min ago"; under a minute reads "just now". */
  ago: (ms: number) => (ms < 60_000 ? 'just now' : `${duration(ms)} ago`),
  count: (count: number) => plural(count, 'active alert'),
  section: {
    title: 'Alerts',
    loading: 'Loading alerts…',
    calm: 'Nothing needs attention.',
    columns: { alert: 'Alert', posted: 'Posted', actions: 'Actions' },
    runDetails: 'Run details',
    cleared: 'cleared',
    dismissed: 'dismissed by hand',
    showPast: (count: number) => `Show ${plural(count, 'past alert')}`,
    hidePast: 'Hide past alerts',
    settings: 'Alert settings',
  },
  strip: { all: 'All alerts' },
  dismiss: {
    action: 'Dismiss',
    hint: 'Hides the alert. Not signed: the timeline records "by hand".',
    done: 'Alert dismissed',
    doneDetail: 'Recorded by hand.',
  },
  banner: {
    /** "Cost $5.40, above the $5.00 threshold · alert": the cost alert names its numbers. */
    cost: (p: Params) =>
      `Cost ${money(p.spentUsd)}, above the ${money(p.maxUsd)} threshold · alert`,
    alert: 'Alert',
  },
  /** Settings → Alerts (S-21-T9). */
  settings: {
    title: 'Alerts',
    affects: 'when the app speaks up about a problem, and where. Alerts never stop a round.',
    loading: 'Loading alert settings…',
    when: 'When to alert',
    where: 'Where alerts go',
    failed: {
      label: 'A run failed',
      hint: 'A stage timed out or crashed. The alert names the stage and the Retry action.',
      toggle: 'Alert when a run fails',
    },
    rounds: {
      label: 'Automatic rounds used',
      hint: 'A chain used all its automatic rounds and a fix is still open. Someone has to look at the PR.',
      toggle: 'Alert when automatic rounds are used up',
    },
    cost: {
      label: 'Cost of one PR',
      get hint() {
        return `${isApiEquivalent() ? `${API_EQUIVALENT} cost` : 'Real spend'} on the PR: every round, fix and retry. Trials and the analyst do not count. A warning, not a limit: rounds keep running.`;
      },
      toggle: 'Alert when one PR costs too much',
      above: 'above',
      currency: '$',
      perPr: 'per PR',
      input: 'Cost threshold in dollars',
      invalid: 'Enter a cost above $0.',
    },
    budget: {
      label: 'Daily budget',
      hint: "Once when today's spend passes the threshold, and once when the budget is reached.",
      toggle: 'Alert about the daily budget',
      at: 'at',
      select: 'Budget threshold',
      percent: (percent: number) => `${percent}%`,
      andFull: 'and at 100%',
    },
    comment: {
      label: 'ClickUp comment',
      hint: "On the PR's ClickUp task, so everyone who follows the task gets a notification. Signed by the bot in the text. Always on.",
      where: "On the PR's task",
      show: 'Preview comment',
      hide: 'Hide preview',
      example: (prNumber: number) => `Example: a cost alert on #${prNumber}`,
      /** The repository in the preview's link. */
      sampleRepo: 'example',
    },
    task: {
      label: 'General alerts task',
      hint: 'Budget alerts, and alerts for PRs with no linked task, go here.',
      input: 'General alerts task ID',
      placeholder: 'ClickUp task ID',
      invalid: 'Enter a ClickUp task ID for general alerts.',
    },
    dashboard: {
      label: 'On the dashboard',
      hint: 'Always on, so nobody has to open ClickUp to see that something is wrong: a bell on the PR card, a line in the Next step banner, the strip above the board, the count on the status chip and the list in Activity.',
      value: 'Always on',
      activity: 'Activity',
    },
    on: 'On',
    off: 'Off',
    /** How each setting reads in the save dialog. */
    values: {
      cost: (usd: number) => `Above ${money(usd)}`,
      budget: (percent: number) => `${percent}% and 100%`,
      noTask: 'Not set',
    },
    invalidSummary: 'Fix the highlighted fields to save.',
    saveTitle: 'Save alert settings',
  },
  /** Timeline entries `alert_raised` (by the bot) and `alert_dismissed` (by hand). */
  timeline: {
    raised: (p: Params, c: AlertNames) =>
      `Alert posted as a ClickUp comment${p.taskId ? ` on ${s(p.taskId)}` : ''}: ${titleOf(p.title, c)}`,
    dismissed: (p: Params, c: AlertNames) => `Dismissed the alert: ${titleOf(p.title, c)}`,
  },
};
