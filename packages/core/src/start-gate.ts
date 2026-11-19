// S-10-T2: whether a round or an agent session may start now (FR-021, NFR Budget).
import './reasons/config.ts';
import { holdReason, type AppSettings } from './config.ts';
import type { QueueCause } from './model.ts';
import { reason, type Reason } from './reason.ts';

/** `round`: a queued run is about to start. `session`: an agent stage of a started run. */
export type GateKind = 'round' | 'session';

export type GateStatus = Pick<
  AppSettings,
  'paused' | 'pausedBy' | 'pausedReason' | 'dailyBudgetUsd' | 'agentSlots'
>;

/** A run that holds an agent slot (running, or let through and starting). */
export type SlotHolder = { prNumber: number };

export type StartGateInput = {
  status: GateStatus;
  /** Today's spend in USD (since local midnight). */
  spentToday: number;
  /** The slot holders other than the run asking, oldest first. */
  activeRuns: readonly SlotHolder[];
  kind: GateKind;
  /** Queued runs older than the one asking that wait for a slot; they take free slots first. */
  queuedAhead?: number;
  /** The stored Claude usage limit hold (P-25), if any; it holds every run until `until`. */
  usageLimit?: UsageLimitHold | null;
  /** Now, in ms; compared with the usage limit's `until`. */
  now?: number;
};

export type GateWaitReason = Reason<
  'paused' | 'budget_reached' | 'slots_busy' | 'usage_limit_reached'
>;
export type StartGateDecision = { start: true } | { start: false; reason: GateWaitReason };

/**
 * Start or wait, with the reason. Paused holds new rounds only (running rounds finish); a reached
 * budget holds new rounds and every session; slots hold new rounds only, because a started round
 * already has its slot.
 */
export function startGate(input: StartGateInput): StartGateDecision {
  const { status, spentToday, activeRuns, kind, queuedAhead = 0 } = input;
  const hold = holdReason(kind === 'round' ? status : { ...status, paused: false }, spentToday);
  if (hold) return { start: false, reason: hold };
  // The subscription's limit holds new rounds and every session: a session now would fail.
  const limit = activeUsageLimit(input.usageLimit, input.now ?? Date.now());
  if (limit) return { start: false, reason: limit };
  if (kind === 'session') return { start: true };

  const free = status.agentSlots - activeRuns.length;
  if (free > queuedAhead) return { start: true };
  const prs = [...new Set(activeRuns.map((run) => run.prNumber))];
  return { start: false, reason: reason('slots_busy', { slots: status.agentSlots, prs }) };
}

/**
 * The PR state's queue cause for a stored wait reason (S-10-T6): paused and budget come with
 * their details; slots busy, or no reason stored yet, is a wait for a free slot.
 */
export function queueCauseOf(wait: Reason | null | undefined): QueueCause {
  if (wait?.code === 'paused') {
    return { cause: 'paused', by: wait.params.by ?? null, note: wait.params.note ?? '' };
  }
  if (wait?.code === 'budget_reached') {
    const { spentUsd, budgetUsd } = wait.params;
    return { cause: 'budget', spentUsd, budgetUsd };
  }
  if (wait?.code === 'usage_limit_reached') {
    return { cause: 'usage_limit', until: wait.params.until };
  }
  return { cause: 'slot' };
}

/** The stored hold after a session hit the Claude usage limit (P-25). */
export type UsageLimitHold = { until: string; resetsAt: string | null };

/** After the reported reset, runs wait this much longer, so the limit has surely reset. */
export const USAGE_LIMIT_MARGIN_MS = 60_000;
/** Without a reported reset, runs try again after this long (a 5-hour window resets in parts). */
export const USAGE_LIMIT_FALLBACK_MS = 30 * 60_000;

/**
 * When runs go on after a usage limit: just after the reported reset, or after the fallback when
 * the SDK named none. A reset already past (clock skew) waits the margin only.
 */
export function usageLimitHold(resetsAt: string | null, now: number): UsageLimitHold {
  const reset = resetsAt ? Date.parse(resetsAt) : Number.NaN;
  const until = Number.isNaN(reset)
    ? now + USAGE_LIMIT_FALLBACK_MS
    : Math.max(reset, now) + USAGE_LIMIT_MARGIN_MS;
  return { until: new Date(until).toISOString(), resetsAt: Number.isNaN(reset) ? null : resetsAt };
}

/** The hold's wait reason while it lasts, else null. */
export function activeUsageLimit(
  hold: UsageLimitHold | null | undefined,
  now: number,
): Reason<'usage_limit_reached'> | null {
  if (!hold || Date.parse(hold.until) <= now) return null;
  return reason('usage_limit_reached', { until: hold.until, resetsAt: hold.resetsAt });
}
