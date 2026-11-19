import type {
  Actor,
  ChangeType,
  Decision,
  LevelNumber,
  RunKind,
  Severity,
  StageKey,
  Verdict,
} from './vocabulary.ts';

/** Quoted evidence for a verdict: the quote must exist word for word in the file. */
export interface Evidence {
  file: string;
  line: number | null;
  quote: string;
}

/** Whether a finding's fix is obvious, or needs a person to choose between fixes. */
export type Remedy = 'obvious' | 'needs_decision';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
  suggestion: string;
  remedy: Remedy | null;
  /** `unchecked` below level 3, where nothing is verified. */
  verdict: Verdict;
  evidence: Evidence[];
  decision: Decision | null;
  /** Result of a fix check: true Resolved, false Not resolved, null not checked yet. */
  resolved: boolean | null;
}

export interface Question {
  id: string;
  answered: boolean;
}

export type SensitiveStatus = 'pending' | 'approved' | 'sent_back';

/** Sensitive files a PR changes, and whether a person approved them. */
export interface SensitiveFiles {
  status: SensitiveStatus;
  files: readonly string[];
  /** Who sent them back (signed), when `status` is `sent_back`. */
  sentBackBy: Actor | null;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** How a round started. Every start other than `own_fix` begins a new chain. */
export type RoundTrigger = 'ready_for_review' | 'manual' | 'own_fix';

/** A full review (round 1 of a chain) or a fix check (rounds 2 and 3). */
export type RoundKind = 'full' | 'fix_check';

/** A run as the round and chain rules see it. */
export interface RunRecord {
  id: string;
  kind: RunKind;
  status: RunStatus;
  trigger: RoundTrigger;
  startedBy: Actor;
  /** The commit the run works on. */
  sha: string;
  /** For `own_fix` rounds: the commit PR Review Agent pushed. */
  fixSha: string | null;
  level: LevelNumber;
}

/** One round's output as the findings rules see it. */
export interface RoundResult {
  id: string;
  status: RunStatus;
  level: LevelNumber;
  findings: Finding[];
  questions: Question[];
  /** Sensitive files the round's diff touches; null when it touches none. */
  sensitive: SensitiveFiles | null;
}

/** Why a queued run waits. */
export type QueueCause =
  | { cause: 'paused'; by: Actor | null; note: string }
  | { cause: 'budget'; spentUsd: number; budgetUsd: number }
  | { cause: 'slot' };

/** The PR's active run, as the state table needs it. */
export interface ActiveRun {
  kind: RunKind;
  status: 'queued' | 'running';
  roundKind: RoundKind | null;
  trigger: RoundTrigger;
  startedBy: Actor;
  /** Round number in its chain; null for runs that are not rounds. */
  roundNumber: number | null;
  fixSha: string | null;
  /** Set when a failed round is being retried from this stage. */
  retryFrom: StageKey | null;
  queue: QueueCause | null;
}

/** The last round, when it failed and has not been retried or replaced. */
export interface FailedRound {
  stage: StageKey;
  errorCode: string;
  roundNumber: number;
  timeoutMinutes: number | null;
}

export type PatchStatus = 'ready' | 'pushed' | 'discarded';

export interface Patch {
  status: PatchStatus;
  fixed: number;
  total: number;
  reproductionsPass: boolean;
  /** Level 5 autofix stopped before the push, and why. */
  waiting: 'sensitive' | null;
}

export type CheckConclusion =
  | 'success'
  | 'skipped'
  | 'neutral'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'stale'
  | null;

export interface CiCheck {
  name: string;
  /** null while the check is still running. */
  conclusion: CheckConclusion;
}

/**
 * A plain snapshot of one PR, with no DB types. The PR state table, the merge checklist and the
 * round rules all read it.
 */
export interface PrSnapshot {
  state: 'open' | 'closed' | 'merged';
  /** Who merged or closed it. */
  closedBy: Actor | null;
  draft: boolean;
  fork: boolean;
  /** GitHub login of the PR author. */
  author: string;
  level: LevelNumber;
  headSha: string;
  /** The commit the last completed round reviewed; null when never reviewed. */
  reviewedSha: string | null;
  commitsSinceReview: number;
  changeType: ChangeType | null;
  activeRun: ActiveRun | null;
  failedRound: FailedRound | null;
  /** Completed rounds in the current chain (0 to 3). */
  chainRounds: number;
  findings: Finding[];
  questions: Question[];
  sensitive: SensitiveFiles | null;
  patch: Patch | null;
  /** People who gave opinions on this PR's findings. */
  reviewers: number;
  ci: CiCheck[];
  /** GitHub logins with an open "changes requested" review. */
  changesRequestedBy: string[];
}
