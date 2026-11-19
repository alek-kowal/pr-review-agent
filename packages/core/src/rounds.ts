import './reasons/rounds.ts';
import type { PrSnapshot, RoundTrigger, RunRecord, RunStatus } from './model.ts';
import { reason, type Reason } from './reason.ts';
import { BOT, type Actor, type LevelNumber, type RunKind } from './vocabulary.ts';

/** A chain is the round that started it plus at most 2 automatic re-reviews after own fixes. */
export const MAX_CHAIN_ROUNDS = 3;

/** A GitHub `pull_request` event, by its action. */
export interface PrEvent {
  action: string;
}

export type RoundStart =
  | {
      start: true;
      roundNumber: number;
      trigger: RoundTrigger;
      startedBy: Actor;
      /** A new round keeps the PR's level; the run then freezes it. */
      level: LevelNumber;
      fixSha: string | null;
      reason: Reason;
    }
  | { start: false; reason: Reason };

const STARTING_ACTIONS = ['opened', 'ready_for_review'];
const blocksStart = (run: { kind: RunKind; status: RunStatus } | null) =>
  !!run &&
  (run.kind === 'round' || run.kind === 'implementer') &&
  (run.status === 'queued' || run.status === 'running');

/**
 * Round 1 starts, signed by the bot, only when a PR that is not a fork becomes ready for review.
 * A push never starts a review.
 */
export function roundStartForEvent(
  event: PrEvent,
  pr: Pick<PrSnapshot, 'state' | 'draft' | 'fork' | 'level'>,
  activeRun: { kind: RunKind; status: RunStatus } | null,
): RoundStart {
  const no = (why: Reason): RoundStart => ({ start: false, reason: why });
  if (event.action === 'closed' || pr.state !== 'open') return no(reason('pr_closed'));
  if (event.action === 'synchronize') return no(reason('push_never_starts'));
  if (event.action === 'converted_to_draft' || pr.draft) return no(reason('draft'));
  if (!STARTING_ACTIONS.includes(event.action)) {
    return no(reason('event_ignored', { action: event.action }));
  }
  if (pr.fork) return no(reason('fork'));
  if (activeRun && blocksStart(activeRun)) {
    return no(reason('run_active', { kind: activeRun.kind, status: activeRun.status }));
  }
  return {
    start: true,
    roundNumber: 1,
    trigger: 'ready_for_review',
    startedBy: BOT,
    level: pr.level,
    fixSha: null,
    reason: reason('ready_for_review', { action: event.action }),
  };
}

export interface ChainRound {
  runId: string;
  roundNumber: number;
  status: RunStatus;
  trigger: RoundTrigger;
  startedBy: Actor;
  fixSha: string | null;
  /** A round 1 after an earlier chain: "new chain". */
  newChain: boolean;
  /** Only completed rounds count toward the chain. */
  counts: boolean;
}

export interface ChainState {
  /** Completed rounds in the current chain. */
  completedRounds: number;
  roundsLeft: number;
  chainStartRunId: string | null;
  rounds: ChainRound[];
}

/**
 * Walks a PR's runs in start order. Every start other than an own fix begins a new chain; only
 * completed rounds count, so failed and cancelled rounds do not use one up.
 */
export function chainState(runs: readonly RunRecord[]): ChainState {
  let completed = 0;
  let chainStartRunId: string | null = null;
  const rounds: ChainRound[] = [];
  for (const run of runs) {
    if (run.kind !== 'round') continue;
    const newChain = run.trigger !== 'own_fix' || chainStartRunId === null;
    if (newChain) {
      completed = 0;
      chainStartRunId = run.id;
    }
    const counts = run.status === 'completed';
    rounds.push({
      runId: run.id,
      roundNumber: completed + 1,
      status: run.status,
      trigger: run.trigger,
      startedBy: run.startedBy,
      fixSha: run.fixSha,
      newChain: newChain && rounds.length > 0,
      counts,
    });
    if (counts) completed++;
  }
  return {
    completedRounds: completed,
    roundsLeft: Math.max(0, MAX_CHAIN_ROUNDS - completed),
    chainStartRunId,
    rounds,
  };
}

/**
 * The next round of a chain starts by itself only when the PR's head is exactly the commit PR
 * Review Agent pushed as a fix, and the chain has fewer than 3 completed rounds.
 */
export function nextAutomaticRound(
  pr: Pick<PrSnapshot, 'state' | 'headSha' | 'level'>,
  chain: Pick<ChainState, 'completedRounds'>,
  ownFixSha: string | null,
): RoundStart {
  if (pr.state !== 'open') return { start: false, reason: reason('pr_closed') };
  if (!ownFixSha || pr.headSha !== ownFixSha) {
    return {
      start: false,
      reason: reason('head_not_own_fix', { headSha: pr.headSha, fixSha: ownFixSha }),
    };
  }
  if (chain.completedRounds >= MAX_CHAIN_ROUNDS) {
    return {
      start: false,
      reason: reason('rounds_used', { used: chain.completedRounds, max: MAX_CHAIN_ROUNDS }),
    };
  }
  const roundNumber = chain.completedRounds + 1;
  return {
    start: true,
    roundNumber,
    trigger: 'own_fix',
    startedBy: BOT,
    level: pr.level,
    fixSha: ownFixSha,
    reason: reason('own_fix_pushed', { fixSha: ownFixSha, roundNumber, max: MAX_CHAIN_ROUNDS }),
  };
}

/** Data for "Round 2 of 3 · started by pr-review-agent after fix abc123". */
export function roundLabel(round: Omit<ChainRound, 'runId' | 'status' | 'counts'>): Reason;
/**
 * The label of one run of a PR, from the PR's `chainState`: "Round 1 of 3 · started by hand",
 * a later round 1 marked "new chain". Null for a run that is not a round of the chain.
 */
export function roundLabel(
  run: Pick<RunRecord, 'id'>,
  chain: Pick<ChainState, 'rounds'>,
): Reason | null;
export function roundLabel(
  subject: Omit<ChainRound, 'runId' | 'status' | 'counts'> | Pick<RunRecord, 'id'>,
  chain?: Pick<ChainState, 'rounds'>,
): Reason | null {
  const round = chain
    ? chain.rounds.find((r) => r.runId === (subject as Pick<RunRecord, 'id'>).id)
    : (subject as Omit<ChainRound, 'runId' | 'status' | 'counts'>);
  if (!round) return null;
  return reason('round_label', {
    roundNumber: round.roundNumber,
    max: MAX_CHAIN_ROUNDS,
    trigger: round.trigger,
    startedBy: round.startedBy,
    fixSha: round.fixSha,
    newChain: round.newChain,
  });
}
