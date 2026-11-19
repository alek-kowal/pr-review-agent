import './reasons/pr-state.ts';
import { openQuestions, toDecide, toFix } from './findings.ts';
import { implementBlock } from './implement-gate.ts';
import type { PrSnapshot } from './model.ts';
import { reason, type Reason } from './reason.ts';
import { MAX_CHAIN_ROUNDS } from './rounds.ts';

/** The plain input of the state table. */
export type PrStateInput = PrSnapshot;

export const PR_STATES = [
  'merged',
  'closed',
  'queued',
  'round_running',
  'fix_check_running',
  'fixing',
  'stage_failed',
  'draft',
  'never_reviewed',
  'new_commits',
  'patch_ready',
  'questions_waiting',
  'findings_to_decide',
  'sensitive_files',
  'waiting_for_fix',
  'rounds_used',
  'ready_to_merge',
] as const;
export type PrState = (typeof PR_STATES)[number];

export const LANES = ['not_reviewed', 'agents_working', 'action_needed', 'ready_to_merge'] as const;
export type Lane = (typeof LANES)[number];

/** The banner's colour is the state's tone. */
export type Tone = 'neutral' | 'working' | 'action' | 'failed' | 'ready';

export type MainActionCode =
  | 'start_review'
  | 'resume'
  | 'cancel'
  | 'retry'
  | 'answer'
  | 'decide'
  | 'approve_sensitive'
  | 'implement_with_agent'
  | 'push'
  | 'merge';

export interface MainAction {
  action: MainActionCode;
  /** Signed actions take a Team member in their own form. */
  signed: boolean;
  /** Offered, but nothing waits for it (Start review on a draft). */
  optional: boolean;
  /** Shown disabled, with the reason (Implement with agent below level 4). */
  disabled: Reason | null;
  /** The stage a retry starts from. */
  stage: string | null;
}

export interface NextStep {
  state: PrState;
  /** null when the PR leaves the board (merged or closed). */
  lane: Lane | null;
  tone: Tone;
  banner: Reason;
  who: Reason;
  mainAction: MainAction | null;
}

/** Runs that change a PR's state; trials and the analyst never do. */
const stateRun = (input: PrStateInput) =>
  input.activeRun && (input.activeRun.kind === 'round' || input.activeRun.kind === 'implementer')
    ? input.activeRun
    : null;

/** The PR's one state. States are checked in the PRD order, and the first match wins. */
export function prState(input: PrStateInput): PrState {
  if (input.state === 'merged') return 'merged';
  if (input.state === 'closed') return 'closed';
  const run = stateRun(input);
  if (run) {
    if (run.status === 'queued') return 'queued';
    if (run.kind === 'implementer') return 'fixing';
    return run.roundKind === 'fix_check' ? 'fix_check_running' : 'round_running';
  }
  if (input.failedRound) return 'stage_failed';
  if (!input.reviewedSha) return input.draft ? 'draft' : 'never_reviewed';
  if (input.commitsSinceReview > 0) return 'new_commits';
  if (input.patch?.status === 'ready') return 'patch_ready';
  if (openQuestions(input.questions).length) return 'questions_waiting';
  if (toDecide(input.findings).length) return 'findings_to_decide';
  if (input.sensitive && input.sensitive.status !== 'approved') return 'sensitive_files';
  if (toFix(input.findings).length || input.ownFixUnchecked) {
    return input.chainRounds >= MAX_CHAIN_ROUNDS ? 'rounds_used' : 'waiting_for_fix';
  }
  return 'ready_to_merge';
}

export function laneOf(state: PrState): Lane | null {
  switch (state) {
    case 'merged':
    case 'closed':
      return null;
    case 'draft':
    case 'never_reviewed':
      return 'not_reviewed';
    case 'queued':
    case 'round_running':
    case 'fix_check_running':
    case 'fixing':
      return 'agents_working';
    case 'ready_to_merge':
      return 'ready_to_merge';
    default:
      return 'action_needed';
  }
}

/** Action needed cards sort by what blocks most: failures first, used-up chains last. */
export const ACTION_NEEDED_ORDER: readonly PrState[] = [
  'stage_failed',
  'questions_waiting',
  'findings_to_decide',
  'sensitive_files',
  'patch_ready',
  'waiting_for_fix',
  'new_commits',
  'rounds_used',
];

export function actionNeededOrder(a: PrState, b: PrState): number {
  const rank = (s: PrState) => {
    const i = ACTION_NEEDED_ORDER.indexOf(s);
    return i < 0 ? ACTION_NEEDED_ORDER.length : i;
  };
  return rank(a) - rank(b);
}

const action = (
  code: MainActionCode,
  signed: boolean,
  extra: Partial<Omit<MainAction, 'action' | 'signed'>> = {},
): MainAction => ({ action: code, signed, optional: false, disabled: null, stage: null, ...extra });

const TONE: Record<Lane, Tone> = {
  not_reviewed: 'neutral',
  agents_working: 'working',
  action_needed: 'action',
  ready_to_merge: 'ready',
};

/** What is needed next, who usually does it, and the one main action. */
export function nextStep(input: PrStateInput): NextStep {
  const state = prState(input);
  const lane = laneOf(state);
  const tone: Tone = state === 'stage_failed' ? 'failed' : lane ? TONE[lane] : 'neutral';
  const author = input.author;
  const usuallyAuthor = reason('who_usually_author', { author });
  const noOne = reason('who_no_one_needs_to_act');
  const max = MAX_CHAIN_ROUNDS;
  const run = stateRun(input);
  const roundNumber = run?.roundNumber ?? 1;
  const step = (banner: Reason, who: Reason, mainAction: MainAction | null): NextStep => ({
    state,
    lane,
    tone,
    banner,
    who,
    mainAction,
  });

  switch (state) {
    case 'merged':
      return step(reason('state_merged', { by: input.closedBy }), reason('who_nobody'), null);
    case 'closed':
      return step(reason('state_closed', { by: input.closedBy }), reason('who_nobody'), null);
    case 'queued': {
      const queue = run?.queue ?? { cause: 'slot' as const };
      if (queue.cause === 'slot') {
        return step(
          reason('state_queued_slot'),
          reason('who_starts_by_itself'),
          action('cancel', false),
        );
      }
      const banner =
        queue.cause === 'paused'
          ? reason('state_queued_paused', { by: queue.by, note: queue.note })
          : reason('state_queued_budget', { spentUsd: queue.spentUsd, budgetUsd: queue.budgetUsd });
      return step(banner, reason('who_anyone_can_resume'), action('resume', true));
    }
    case 'round_running': {
      const banner = run?.retryFrom
        ? reason('state_round_retrying', { stage: run.retryFrom, roundNumber, max })
        : run?.trigger === 'ready_for_review'
          ? reason('state_round_starting', { roundNumber, max })
          : reason('state_round_running_by_hand', { roundNumber, max });
      return step(banner, noOne, action('cancel', false));
    }
    case 'fix_check_running':
      return step(
        reason('state_fix_check_running', { fixSha: run?.fixSha ?? null, roundNumber, max }),
        noOne,
        action('cancel', false),
      );
    case 'fixing':
      return step(
        reason('state_fixing', { count: toFix(input.findings).length, startedBy: run!.startedBy }),
        noOne,
        action('cancel', false),
      );
    case 'stage_failed': {
      const failed = input.failedRound!;
      return step(
        reason('state_stage_failed', {
          stage: failed.stage,
          errorCode: failed.errorCode,
          timeoutMinutes: failed.timeoutMinutes,
          roundNumber: failed.roundNumber,
        }),
        reason('who_anyone_can_retry'),
        action('retry', false, { stage: failed.stage }),
      );
    }
    case 'draft':
      return step(
        reason('state_draft'),
        reason('who_author_marks_ready', { author }),
        action('start_review', false, { optional: true }),
      );
    case 'never_reviewed':
      return step(
        reason('state_never_reviewed', { fork: input.fork }),
        reason('who_anyone_can_start'),
        action('start_review', false),
      );
    case 'new_commits':
      return step(
        reason('state_new_commits', {
          count: input.commitsSinceReview,
          reviewedSha: input.reviewedSha!,
        }),
        usuallyAuthor,
        action('start_review', false),
      );
    case 'patch_ready': {
      const patch = input.patch!;
      const banner = patch.waiting
        ? reason('state_autofix_waiting', { reason: patch.waiting })
        : reason('state_patch_ready', {
            fixed: patch.fixed,
            total: patch.total,
            reproductionsPass: patch.reproductionsPass,
          });
      return step(banner, usuallyAuthor, action('push', true));
    }
    case 'questions_waiting':
      return step(
        reason('state_questions_waiting', {
          count: openQuestions(input.questions).length,
          toDecideAfter: toDecide(input.findings).length,
        }),
        usuallyAuthor,
        action('answer', true),
      );
    case 'findings_to_decide':
      return step(
        reason('state_findings_to_decide', {
          count: toDecide(input.findings).length,
          reviewers: input.reviewers,
        }),
        usuallyAuthor,
        action('decide', true),
      );
    case 'sensitive_files': {
      const sensitive = input.sensitive!;
      const count = sensitive.files.length;
      return sensitive.status === 'sent_back'
        ? step(
            reason('state_sensitive_sent_back', { count, by: sensitive.sentBackBy }),
            usuallyAuthor,
            action('approve_sensitive', false),
          )
        : step(
            reason('state_sensitive_files', { count }),
            reason('who_usually_teammate', { author }),
            action('approve_sensitive', false),
          );
    }
    case 'waiting_for_fix': {
      const disabled = implementBlock(input);
      return step(
        reason('state_waiting_for_fix', { count: toFix(input.findings).length }),
        usuallyAuthor,
        action('implement_with_agent', true, { disabled }),
      );
    }
    case 'rounds_used':
      return step(
        reason('state_rounds_used', {
          used: input.chainRounds,
          max,
          open: toFix(input.findings).length,
        }),
        usuallyAuthor,
        action('start_review', false),
      );
    case 'ready_to_merge':
      return step(
        reason('state_ready_to_merge', { sha: input.reviewedSha! }),
        usuallyAuthor,
        action('merge', true),
      );
  }
}
