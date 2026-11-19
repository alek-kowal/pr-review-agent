// S-18-T1 (FR-065): the four alerts of PRD Business Logic → Alerts. Alerts speak only when
// something is wrong; clearing says nothing, and nothing fires when things go well. Alerts never
// stop or delay a round: these rules only report.
import './reasons/alerts.ts';
import { z } from 'zod/v4';
import { reason, type Reason } from './reason.ts';
import { MAX_CHAIN_ROUNDS } from './rounds.ts';
import type { StageKey } from './vocabulary.ts';

export const ALERT_KINDS = ['failed', 'rounds', 'cost', 'budget'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_STATUSES = ['active', 'resolved', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** The budget alert's first threshold; it fires again when the budget is reached (100%). */
export const BUDGET_ALERT_PERCENTS = [50, 70, 80, 90] as const;
export type BudgetAlertPercent = (typeof BUDGET_ALERT_PERCENTS)[number];

export const DEFAULT_ALERT_COST_USD = 5;
export const DEFAULT_BUDGET_ALERT_PERCENT: BudgetAlertPercent = 80;

const budgetPercent = z.union(BUDGET_ALERT_PERCENTS.map((p) => z.literal(p))) as z.ZodType<
  BudgetAlertPercent,
  BudgetAlertPercent
>;

/** Which alerts are on, their thresholds, and the general alerts task (`alert_config`). */
export const AlertConfigSchema = z.object({
  failedOn: z.boolean().default(true),
  roundsOn: z.boolean().default(true),
  costOn: z.boolean().default(true),
  /** Per PR, in USD, above 0. */
  costMaxUsd: z.number().positive().default(DEFAULT_ALERT_COST_USD),
  budgetOn: z.boolean().default(true),
  budgetPercent: budgetPercent.default(DEFAULT_BUDGET_ALERT_PERCENT),
  /** ClickUp task for budget alerts and for PRs without a linked task; null until set. */
  generalTaskId: z.string().trim().min(1).nullable().default(null),
});
export type AlertConfig = z.output<typeof AlertConfigSchema>;
export const DEFAULT_ALERT_CONFIG: AlertConfig = AlertConfigSchema.parse({});

/** What Settings → Alerts saves (S-21-T9): the general alerts task is required there. */
export const AlertConfigWriteSchema = AlertConfigSchema.extend({
  generalTaskId: z.string().trim().min(1),
});

/** One open PR as the alert rules see it. */
export interface AlertPrSnapshot {
  prId: string;
  number: number;
  /**
   * The open failure: the PR's last round failed and was not retried or replaced. `no` counts the
   * PR's failures, so a later failure is a new alert.
   */
  failure: {
    no: number;
    stage: StageKey;
    errorCode: string;
    timeoutMinutes: number | null;
  } | null;
  /** The chain that used 3 of 3 rounds while a fix is still open; null otherwise. */
  roundsUsedChain: string | null;
  /** Real spend on the PR: every round, fix and retry; trials and the analyst left out. */
  spentUsd: number;
}

export interface AlertSnapshot {
  /** Today in the app time zone, `YYYY-MM-DD`. */
  day: string;
  spentTodayUsd: number;
  /** null or 0: no budget, so no budget alert. */
  dailyBudgetUsd: number | null;
  /** Open PRs only. */
  prs: readonly AlertPrSnapshot[];
}

export type AlertTitle = Reason<'alert_failed' | 'alert_rounds' | 'alert_cost' | 'alert_budget'>;
export type AlertNextStep = Reason<
  'alert_next_retry' | 'alert_next_start_review' | 'alert_next_split' | 'alert_next_budget'
>;
export type AlertEndNote = Reason<
  | 'alert_end_retried'
  | 'alert_end_new_review'
  | 'alert_end_below_threshold'
  | 'alert_end_midnight'
  | 'alert_end_pr_closed'
>;

/** Something is wrong right now. */
export interface AlertCondition {
  kind: AlertKind;
  key: string;
  /** null for the daily budget. */
  prId: string | null;
  title: AlertTitle;
  nextStep: AlertNextStep;
}

export interface AlertConditions {
  day: string;
  /** Kinds that were checked; alerts of a kind switched off are left as they are. */
  on: AlertKind[];
  /** The PRs that were checked (open PRs). */
  prIds: string[];
  items: AlertCondition[];
}

export const alertKey = {
  failed: (prId: string, failureNo: number) => `failed:${prId}:${failureNo}`,
  rounds: (prId: string, chain: string) => `rounds:${prId}:${chain}`,
  cost: (prId: string) => `cost:${prId}`,
  budget: (day: string, percent: number) => `budget:${day}:${percent}`,
};

/** The day a budget alert key belongs to. */
const budgetDay = (key: string) => key.split(':')[1] ?? '';

const KIND_ON: Record<AlertKind, (config: AlertConfig) => boolean> = {
  failed: (c) => c.failedOn,
  rounds: (c) => c.roundsOn,
  cost: (c) => c.costOn,
  budget: (c) => c.budgetOn,
};

/** Every alert that should be active now, for the kinds that are on. */
export function alertConditions(snapshot: AlertSnapshot, config: AlertConfig): AlertConditions {
  const on = ALERT_KINDS.filter((kind) => KIND_ON[kind](config));
  const items: AlertCondition[] = [];
  for (const pr of snapshot.prs) {
    if (config.failedOn && pr.failure) {
      const { no, stage, errorCode, timeoutMinutes } = pr.failure;
      items.push({
        kind: 'failed',
        key: alertKey.failed(pr.prId, no),
        prId: pr.prId,
        title: reason('alert_failed', { prNumber: pr.number, stage, errorCode, timeoutMinutes }),
        nextStep: reason('alert_next_retry', { stage }),
      });
    }
    if (config.roundsOn && pr.roundsUsedChain) {
      items.push({
        kind: 'rounds',
        key: alertKey.rounds(pr.prId, pr.roundsUsedChain),
        prId: pr.prId,
        title: reason('alert_rounds', { prNumber: pr.number, max: MAX_CHAIN_ROUNDS }),
        nextStep: reason('alert_next_start_review'),
      });
    }
    if (config.costOn && pr.spentUsd > config.costMaxUsd) {
      items.push({
        kind: 'cost',
        key: alertKey.cost(pr.prId),
        prId: pr.prId,
        title: reason('alert_cost', {
          prNumber: pr.number,
          spentUsd: pr.spentUsd,
          maxUsd: config.costMaxUsd,
        }),
        nextStep: reason('alert_next_split'),
      });
    }
  }
  const budget = snapshot.dailyBudgetUsd;
  if (config.budgetOn && budget != null && budget > 0) {
    const spent = snapshot.spentTodayUsd;
    for (const percent of [config.budgetPercent, 100]) {
      if (spent >= (budget * percent) / 100) {
        items.push({
          kind: 'budget',
          key: alertKey.budget(snapshot.day, percent),
          prId: null,
          title: reason('alert_budget', { percent, spentUsd: spent, budgetUsd: budget }),
          nextStep: reason('alert_next_budget'),
        });
      }
    }
  }
  return { day: snapshot.day, on, prIds: snapshot.prs.map((pr) => pr.prId), items };
}

/** A stored alert, in any status: a key that exists never fires again. */
export interface KnownAlert {
  key: string;
  kind: AlertKind;
  prId: string | null;
  status: AlertStatus;
}

export interface AlertChanges {
  fire: AlertCondition[];
  /** Active alerts whose problem is gone; the bot clears them without a message. */
  resolve: { key: string; note: AlertEndNote }[];
}

function endNote(alert: KnownAlert, conditions: AlertConditions): AlertEndNote {
  if (alert.kind === 'budget') {
    return budgetDay(alert.key) === conditions.day
      ? reason('alert_end_below_threshold')
      : reason('alert_end_midnight');
  }
  if (alert.prId && !conditions.prIds.includes(alert.prId)) return reason('alert_end_pr_closed');
  return alert.kind === 'failed' ? reason('alert_end_retried') : reason('alert_end_new_review');
}

/**
 * What to store: conditions whose key was never stored fire; active alerts whose condition is gone
 * clear. The cost alert never clears here (only a dismiss ends it), and an alert of a kind that is
 * switched off is left as it is.
 */
export function reconcileAlerts(
  known: readonly KnownAlert[],
  conditions: AlertConditions,
): AlertChanges {
  const stored = new Set(known.map((a) => a.key));
  const fire: AlertCondition[] = [];
  for (const item of conditions.items) {
    if (stored.has(item.key)) continue;
    stored.add(item.key);
    fire.push(item);
  }
  const live = new Set(conditions.items.map((c) => c.key));
  const resolve = known
    .filter(
      (a) =>
        a.status === 'active' &&
        a.kind !== 'cost' &&
        conditions.on.includes(a.kind) &&
        !live.has(a.key),
    )
    .map((a) => ({ key: a.key, note: endNote(a, conditions) }));
  return { fire, resolve };
}

// ---- The ClickUp comment ----
// The bot's own output in ClickUp, not app copy (like `notifyText`): the worker posts this string
// and Settings → Alerts previews it, so the preview is exactly what is posted.

const STAGE_NAME: Record<StageKey, string> = {
  checks: 'Checks',
  task: 'Task',
  change_type: 'Change type',
  review: 'Review',
  verify: 'Verify',
};

const usd = (value: number) => `$${value.toFixed(2)}`;

/** The problem, in one sentence. */
export function alertTitleText(title: AlertTitle): string {
  switch (title.code) {
    case 'alert_failed': {
      const { stage, errorCode, timeoutMinutes } = title.params;
      return errorCode === 'stage_timeout' && timeoutMinutes
        ? `${STAGE_NAME[stage]} stage timed out after ${timeoutMinutes} min`
        : `${STAGE_NAME[stage]} stage failed (${errorCode})`;
    }
    case 'alert_rounds':
      return `Automatic rounds used (${title.params.max} of ${title.params.max}) and a fix is still open`;
    case 'alert_cost':
      return `PR #${title.params.prNumber} has cost ${usd(title.params.spentUsd)}, above the ${usd(title.params.maxUsd)} alert threshold`;
    case 'alert_budget': {
      const { percent, spentUsd, budgetUsd } = title.params;
      return percent >= 100
        ? `Daily budget reached: ${usd(spentUsd)} of ${usd(budgetUsd)}`
        : `Daily budget ${percent}% used: ${usd(spentUsd)} of ${usd(budgetUsd)}`;
    }
  }
}

export function alertNextStepText(next: AlertNextStep): string {
  switch (next.code) {
    case 'alert_next_retry':
      return `Retry from ${STAGE_NAME[next.params.stage]}`;
    case 'alert_next_start_review':
      return 'Start review';
    case 'alert_next_split':
      return 'Check whether the PR should be split';
    case 'alert_next_budget':
      return 'Pause, raise the budget or wait until midnight';
  }
}

export const BOT_SIGNATURE = 'pr-review-agent';

export interface AlertCommentInput {
  title: AlertTitle;
  nextStep: AlertNextStep;
  /** The PR's number, or null for the daily budget. */
  prNumber: number | null;
  /** `${APP_BASE_URL}/pr/<repo>/<number>`, or Activity for the daily budget. */
  link: string;
}

/** The ClickUp comment: the problem, the next step, a link to the app, and the bot's signature. */
export function alertCommentText(input: AlertCommentInput): string {
  const head =
    input.prNumber == null
      ? 'PR Review Agent alert · Daily budget'
      : `PR Review Agent alert · PR #${input.prNumber}`;
  return [
    head,
    `${alertTitleText(input.title)}.`,
    `Next step: ${alertNextStepText(input.nextStep)}.`,
    `Open in PR Review Agent: ${input.link}`,
    `— ${BOT_SIGNATURE}`,
  ].join('\n');
}
