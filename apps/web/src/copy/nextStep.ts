// Copy for core's Next step: the banner title, the board card's short line and who acts, for
// every state code (`state_*`) and who code (`who_*`), and the main action labels.
import type { MainActionCode } from '@pra/core';

export type StepParams = Record<string, unknown>;

/** What a line needs besides its params: names for people. */
export interface StepContext {
  /** The PR author's Team name, or their GitHub login when they are not in Team. */
  author: string;
  /** A person or the bot who did something, by name. */
  actor: (actor: unknown) => string;
  /** A stage key as its name ("Review"). */
  stage: (key: string) => string;
  /** A failure reason code as words ("the stage ran out of time"). */
  reason: (code: string) => string;
}

type Line = (p: StepParams, c: StepContext) => string;

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
/** A commit as its first 7 characters. */
export const shortSha = (sha: unknown): string => String(sha ?? '').slice(0, 7);
const money = (usd: unknown) => `$${n(usd).toFixed(2)}`;
const round = (p: StepParams) => `round ${n(p.roundNumber)} of ${n(p.max)}`;

/** The banner title on the PR page. */
const banner: Record<string, Line> = {
  state_draft: () => 'Draft: review starts when the PR is ready for review',
  state_never_reviewed: () => 'Not reviewed yet',
  state_queued_slot: () => 'Queued: waiting for a free agent slot',
  state_queued_paused: (p, c) =>
    `Queued: paused by ${c.actor(p.by)}${p.note ? ` (${String(p.note)})` : ''}`,
  state_queued_budget: (p) =>
    `Queued: daily budget reached (${money(p.spentUsd)} of ${money(p.budgetUsd)})`,
  state_round_starting: (p) => `Review starting: PR marked ready for review (${round(p)})`,
  state_round_running_by_hand: (p) => `Review running: started by hand (${round(p)})`,
  state_round_retrying: (p, c) =>
    `Retrying from ${c.stage(String(p.stage))}: earlier stages are reused`,
  state_fix_check_running: (p) =>
    p.fixSha
      ? `Re-review: checking the fix ${shortSha(p.fixSha)} (${round(p)})`
      : `Re-review: checking the fix (${round(p)})`,
  state_fixing: (p, c) =>
    `Implementer is fixing ${plural(n(p.count), 'finding')} · started by ${c.actor(p.startedBy)}`,
  state_stage_failed: (p, c) =>
    `Round ${n(p.roundNumber)} failed at ${c.stage(String(p.stage))}: ${c.reason(String(p.errorCode))}`,
  state_new_commits: (p) =>
    `${plural(n(p.count), 'new commit')} since last review (${shortSha(p.reviewedSha)})`,
  state_patch_ready: (p) =>
    `Patch ready: ${n(p.fixed)} of ${n(p.total)} fixed${p.reproductionsPass ? ', reproductions pass' : ''}`,
  state_autofix_waiting_sensitive: () => 'Autofix waiting: patch touches a sensitive file',
  state_questions_waiting: (p) => `Answer ${plural(n(p.count), 'question')}`,
  state_findings_to_decide: (p) => `Decide ${plural(n(p.count), 'finding')}`,
  state_sensitive_files: (p) => `Approve changes to ${plural(n(p.count), 'sensitive file')}`,
  state_sensitive_sent_back: (p, c) =>
    `Sent back by ${c.actor(p.by)}: ${c.author} changes ${plural(n(p.count), 'sensitive file')}`,
  state_waiting_for_fix: (p) => `${plural(n(p.count), 'finding')} to implement`,
  state_rounds_used: (p) => `Automatic rounds used (${n(p.used)} of ${n(p.max)})`,
  state_ready_to_merge: (p) => `Ready to merge at ${shortSha(p.sha)}`,
  state_merged: (p, c) => (p.by ? `Merged by ${c.actor(p.by)}` : 'Merged'),
  state_closed: () => 'Closed without merging',
};

/** The board card's third line, where it differs from the banner title. */
const short: Record<string, Line> = {
  state_draft: () => 'Review starts when the PR is ready',
  state_never_reviewed: (p) => (p.fork ? 'Fork: start the review by hand' : 'Start a review'),
  state_round_starting: (p) => `Round ${n(p.roundNumber)} of ${n(p.max)} is running`,
  state_round_running_by_hand: (p) => `Round ${n(p.roundNumber)} of ${n(p.max)} is running`,
  state_fix_check_running: (p) => `Round ${n(p.roundNumber)} of ${n(p.max)} checks the fix`,
  state_fixing: (p) => `Implementer is fixing ${plural(n(p.count), 'finding')}`,
  state_stage_failed: (p, c) => `${c.stage(String(p.stage))} stage failed`,
  state_new_commits: (p) => `${plural(n(p.count), 'new commit')} since last review`,
  state_patch_ready: () => 'Patch ready: review and push',
  state_autofix_waiting_sensitive: () => 'Autofix waiting: sensitive file',
  state_sensitive_files: (p) => `Approve ${plural(n(p.count), 'sensitive file')}`,
  state_sensitive_sent_back: () => 'Sensitive files sent back',
  state_ready_to_merge: () => 'Merge when you are ready',
};

/** Who usually acts next. */
const who: Record<string, Line> = {
  who_author_marks_ready: (_, c) => `${c.author} marks it ready in GitHub`,
  who_anyone_can_start: () => 'anyone can start it',
  who_anyone_can_resume: () => 'anyone can resume in the status chip',
  who_starts_by_itself: () => 'starts by itself',
  who_no_one_needs_to_act: () => 'no one needs to act',
  who_usually_author: (_, c) => `usually ${c.author} (author)`,
  who_usually_teammate: () => 'usually a teammate, not the author',
  who_anyone_can_retry: () => 'anyone can retry',
  who_nobody: () => '',
};

const actions: Record<MainActionCode, string> = {
  start_review: 'Start review',
  resume: 'Resume…',
  cancel: 'Cancel',
  retry: 'Retry',
  answer: 'Answer questions',
  decide: 'Decide findings',
  approve_sensitive: 'Review sensitive files',
  implement_with_agent: 'Implement with agent…',
  push: 'Push…',
  merge: 'Merge…',
};

export const nextStep = {
  banner,
  short,
  who,
  actions,
  /** Who lines a board card leaves out: the usual case says nothing (docs/03). */
  quietOnCards: ['who_usually_author', 'who_no_one_needs_to_act', 'who_nobody'] as string[],
  label: 'Next step',
  /** The banner's name on a merged or closed PR, where nothing is next. */
  stateLabel: 'State',
  /** The grey line above the banner title. */
  meta: (who: string) => `Next step · ${who}`,
  unknown: (code: string) => `State ${code}`,
  bot: 'PR Review Agent',
  hand: 'hand',
  someone: 'a teammate',
};
