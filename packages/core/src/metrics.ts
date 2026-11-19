// Pilot metrics (S-19, docs/06-metrics.md): pure rules over PR histories.
import type { RunStatus } from './model.ts';
import { laneOf, type PrState } from './pr-state.ts';
import { timeSummary } from './time-summary.ts';
import type { RunKind } from './vocabulary.ts';

/** A commit as GitHub reports it: its parents in order, and its message. */
export type CommitInfo = { parents: readonly string[]; message: string };

const UPDATE_BRANCH_MESSAGE = /^Merge (?:remote-tracking )?branch '[^']+' into /;

/**
 * Whether a head change is a base merge ("Update branch" on GitHub, or the same merge by hand):
 * a merge commit on top of the old head whose other parent is the base, or whose message is
 * git's merge message. Metric 5 ignores these.
 */
export function isBaseMerge(change: {
  beforeSha: string;
  baseSha: string;
  commit: CommitInfo | null;
}): boolean {
  const { commit } = change;
  if (!commit || commit.parents.length !== 2) return false;
  const [first, second] = commit.parents;
  if (first !== change.beforeSha) return false;
  return second === change.baseSha || UPDATE_BRANCH_MESSAGE.test(commit.message);
}

/** Below this many PRs a metric says "too few for firm conclusions" (docs/06-metrics.md). */
export const TOO_FEW_PRS = 10;

/** A metric's value with the number of PRs it is based on. */
export interface Metric<T> {
  value: T;
  sampleSize: number;
  /** Fewer than `TOO_FEW_PRS` PRs. */
  tooFew: boolean;
}

const metric = <T>(value: T, sampleSize: number): Metric<T> => ({
  value,
  sampleSize,
  tooFew: sampleSize < TOO_FEW_PRS,
});

/** The middle value (the mean of the two middle ones for an even count); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Run kinds a PR's own work counts; trials and the analyst are reported apart. */
const PR_WORK_KINDS: readonly RunKind[] = ['round', 'implementer'];

export interface PrHistory {
  outcome: 'open' | 'merged' | 'closed';
  /** First ready for review (`pull_requests.ready_at`); null when never logged. */
  readyAt: Date | null;
  mergedAt: Date | null;
  /** The head SHA GitHub merged (the PR's head at the merge). */
  mergedHeadSha: string | null;
  runs: readonly { kind: RunKind; status: RunStatus }[];
  /** Every stage of every run; queue time is the gap before `startedAt`, so it never counts. */
  stages: readonly { runKind: RunKind; startedAt: Date | null; finishedAt: Date | null }[];
  sessions: readonly { runKind: RunKind; costUsd: number; tokens: number }[];
  stateChanges: readonly { state: PrState; headSha: string; at: Date }[];
  headChanges: readonly { afterSha: string; byBot: boolean; isBaseMerge: boolean; at: Date }[];
}

/** The three lanes of ready → merge; time back in Not reviewed waits on people too. */
export interface LaneSplit {
  agentsWorking: number;
  actionNeeded: number;
  readyToMerge: number;
}

export interface PrMetrics {
  /** Metric 1: summed stage durations of rounds and implementer runs, failed ones included. */
  agentWorkMs: number;
  /** Metric 2 (merged PRs): ready → merge, and its split by lane; null otherwise. */
  readyToMergeMs: number | null;
  lanes: LaneSplit | null;
  /** Metric 3: rounds and implementer runs at API rates, with their tokens. */
  costUsd: number;
  tokens: number;
  /** Reported apart from metric 3. */
  trialCostUsd: number;
  analystCostUsd: number;
  /** Metric 4: rounds in total, and whether a chain used 3 of 3 with a fix still open. */
  rounds: number;
  chainUsedUp: boolean;
  /** Metric 5 (merged PRs that reached Ready to merge); null when it does not apply. */
  changedAfterReady: boolean | null;
  /** Base merges after Ready to merge that metric 5 ignored. */
  ignoredBaseMerges: number;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const ms = (from: Date, to: Date) => Math.max(0, to.getTime() - from.getTime());

function lanesOf(history: PrHistory): LaneSplit {
  const summary = timeSummary(history.stateChanges, [], history.mergedAt ?? new Date(0));
  const { byLane } = summary;
  return {
    agentsWorking: byLane.agents_working,
    actionNeeded: byLane.action_needed + byLane.not_reviewed,
    readyToMerge: byLane.ready_to_merge,
  };
}

/** Metric 5 for one merged PR: a person's commit, or a merge at an unseen head, after Ready. */
function changedAfterReady(history: PrHistory): { changed: boolean | null; ignored: number } {
  if (history.outcome !== 'merged') return { changed: null, ignored: 0 };
  const changes = [...history.stateChanges].sort((a, b) => a.at.getTime() - b.at.getTime());
  const ready = changes.find((c) => c.state === 'ready_to_merge');
  if (!ready) return { changed: null, ignored: 0 };
  const after = history.headChanges.filter((h) => h.at.getTime() >= ready.at.getTime());
  const ignored = after.filter((h) => h.isBaseMerge && !h.byBot).length;
  const byPerson = after.some((h) => !h.byBot && !h.isBaseMerge);
  const knownHeads = new Set([ready.headSha, ...after.map((h) => h.afterSha)]);
  const mergedElsewhere = history.mergedHeadSha !== null && !knownHeads.has(history.mergedHeadSha);
  return { changed: byPerson || mergedElsewhere, ignored };
}

/** One PR's figures for the five metrics. */
export function prMetrics(history: PrHistory): PrMetrics {
  const work = (kind: RunKind) => PR_WORK_KINDS.includes(kind);
  const agentWorkMs = sum(
    history.stages
      .filter((s) => work(s.runKind) && s.startedAt && s.finishedAt)
      .map((s) => ms(s.startedAt!, s.finishedAt!)),
  );
  const merged = history.outcome === 'merged' && history.mergedAt !== null;
  const readyAt =
    history.readyAt ??
    history.stateChanges.find((c) => c.state !== 'draft' && laneOf(c.state) !== null)?.at ??
    null;
  const costOf = (kinds: readonly RunKind[]) =>
    sum(history.sessions.filter((s) => kinds.includes(s.runKind)).map((s) => s.costUsd));
  const { changed, ignored } = changedAfterReady(history);
  return {
    agentWorkMs,
    readyToMergeMs: merged && readyAt ? ms(readyAt, history.mergedAt!) : null,
    lanes: merged ? lanesOf(history) : null,
    costUsd: costOf(PR_WORK_KINDS),
    tokens: sum(history.sessions.filter((s) => work(s.runKind)).map((s) => s.tokens)),
    trialCostUsd: costOf(['trial']),
    analystCostUsd: costOf(['analyst']),
    rounds: history.runs.filter((r) => r.kind === 'round').length,
    chainUsedUp: history.stateChanges.some((c) => c.state === 'rounds_used'),
    changedAfterReady: changed,
    ignoredBaseMerges: ignored,
  };
}

export interface PilotMetrics {
  /** 1. Median agent work per PR (ms), over every PR. */
  agentWork: Metric<number | null>;
  /** 2. Median ready → merge (ms) over merged PRs, and the summed lane split. */
  readyToMerge: Metric<number | null> & { lanes: LaneSplit };
  /** 3. Median cost per PR (USD); trials and the analyst summed apart. */
  cost: Metric<number | null> & { tokens: number; trialCostUsd: number; analystCostUsd: number };
  /** 4. PRs where a chain used 3 of 3 with a fix open, next to PRs with more than 3 rounds. */
  roundsUsedUp: Metric<number> & { overThreeRounds: number };
  /** 5. Merged PRs changed by a person after Ready to merge (a lower bound). */
  changedAfterReady: Metric<number> & { ignoredBaseMerges: number };
}

/** The five pilot metrics over PRs that finished in the range (docs/06-metrics.md). */
export function pilotMetrics(prs: readonly PrMetrics[]): PilotMetrics {
  const merged = prs.filter((p) => p.readyToMergeMs !== null);
  const lanes = merged.reduce<LaneSplit>(
    (total, p) => ({
      agentsWorking: total.agentsWorking + (p.lanes?.agentsWorking ?? 0),
      actionNeeded: total.actionNeeded + (p.lanes?.actionNeeded ?? 0),
      readyToMerge: total.readyToMerge + (p.lanes?.readyToMerge ?? 0),
    }),
    { agentsWorking: 0, actionNeeded: 0, readyToMerge: 0 },
  );
  return {
    agentWork: metric(median(prs.map((p) => p.agentWorkMs)), prs.length),
    readyToMerge: {
      ...metric(median(merged.map((p) => p.readyToMergeMs!)), merged.length),
      lanes,
    },
    cost: {
      ...metric(median(prs.map((p) => p.costUsd)), prs.length),
      tokens: sum(prs.map((p) => p.tokens)),
      trialCostUsd: sum(prs.map((p) => p.trialCostUsd)),
      analystCostUsd: sum(prs.map((p) => p.analystCostUsd)),
    },
    roundsUsedUp: {
      ...metric(prs.filter((p) => p.chainUsedUp).length, prs.length),
      overThreeRounds: prs.filter((p) => p.rounds > 3).length,
    },
    changedAfterReady: {
      ...metric(merged.filter((p) => p.changedAfterReady === true).length, merged.length),
      ignoredBaseMerges: sum(merged.map((p) => p.ignoredBaseMerges)),
    },
  };
}
