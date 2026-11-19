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
};

export type GateWaitReason = Reason<'paused' | 'budget_reached' | 'slots_busy'>;
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
  return { cause: 'slot' };
}
