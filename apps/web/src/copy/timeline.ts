// Copy for the PR Timeline tab: the time summary and one sentence per entry kind.
import { alerts } from './alerts.ts';
import { autofix } from './autofix.ts';
import { checks } from './checks.ts';
import { failureParams, shortSha } from './nextStep.ts';
import { money, plural, reviewCounts } from './format.ts';

type Params = Record<string, unknown>;
const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

/** What a run is called on the timeline: "Round 1 of 3", or its kind. */
function runName(p: Params): string {
  if (p.runKind === 'round' || p.runKind === undefined) {
    return p.roundNumber === null || p.roundNumber === undefined
      ? 'Round'
      : `Round ${n(p.roundNumber)} of 3`;
  }
  const kinds: Record<string, string> = {
    implementer: 'Implementer run',
    trial: 'Trial run',
    analyst: 'Analyst run',
  };
  return kinds[String(p.runKind)] ?? `${String(p.runKind)} run`;
}

/** The short name a finished run ends with: "Round 1", "Implementer run". */
const runShort = (p: Params) =>
  p.runKind === 'round' && p.roundNumber !== null && p.roundNumber !== undefined
    ? `Round ${n(p.roundNumber)}`
    : runName(p);

/** A PR level as the timeline names it; null is the repository default. */
const prLevel = (value: unknown) =>
  value === null || value === undefined ? 'the repository default' : `level ${n(value)}`;

const DECISIONS: Record<string, string> = {
  implement: 'implement',
  reject: 'reject',
  defer: 'defer to ClickUp',
};

/** What the reconcile poll corrected (S-03-T14), as the sentence names it. */
const CORRECTIONS: Record<string, (p: Params) => string> = {
  head: (p) => (p.headSha ? `head ${shortSha(p.headSha)}` : 'head'),
  draft: () => 'draft',
  ready: () => 'ready for review',
  closed: () => 'closed',
  merged: () => 'merged',
  reopened: () => 'reopened',
  ci: () => 'CI',
};

function reconciled(p: Params): string {
  const corrections = Array.isArray(p.corrections) ? p.corrections.map(String) : [];
  if (corrections.includes('imported')) return 'Imported from GitHub';
  const parts = corrections.map((c) => CORRECTIONS[c]?.(p) ?? c.replaceAll('_', ' '));
  return parts.length ? `Corrected from GitHub: ${parts.join(', ')}` : 'Corrected from GitHub';
}

/** Helpers an entry sentence may need: stage and failure names. */
export interface TimelineContext {
  stage: (key: string) => string;
  reason: (code: string, params?: Record<string, unknown> | null) => string;
}

export const timeline = {
  loading: 'Loading the timeline…',
  summaryLabel: 'Time summary',
  notReady: 'Not ready for review yet.',
  readyAt: 'Ready for review',
  total: { open: 'Open for', merged: 'Ready → merged', closed: 'Ready → closed' },
  agentsWorked: 'Agents worked',
  waiting: 'Waiting for people and merge',
  cost: 'Cost',
  money,
  entriesLabel: 'Timeline entries',
  empty: 'Nothing on the timeline yet.',
  filterLabel: 'Filter timeline',
  filters: { all: 'Everything', people: 'People', bot: 'PR Review Agent' },
  noMatch: 'No entry matches this filter.',
  /** Who acted. */
  actor: {
    bot: 'PR Review Agent',
    hand: 'By hand',
    someone: 'Someone',
  },
  inGitHub: 'in GitHub',
  entries: {
    pr_ready: () => 'PR marked ready for review',
    pr_pushed: (p) => (p.headSha ? `Pushed ${shortSha(p.headSha)}` : 'Pushed new commits'),
    pr_reconciled: reconciled,
    change_type_forced: (p) =>
      p.to
        ? `Change type forced to ${checks.changeType(String(p.to))}`
        : 'Change type back to automatic',
    pr_closed: () => 'PR closed',
    pr_merged: (p) =>
      p.via === 'app' && p.sha ? `Squash-merged at ${shortSha(p.sha)}` : 'PR merged',
    merge_refused: (p) =>
      `GitHub refused the merge at ${shortSha(p.sha)}: ${String(p.message ?? '')}`,
    run_started: (p) => `${runName(p)} started`,
    run_finished: (p) => `${runShort(p)} finished`,
    run_failed: (p, c) =>
      p.stage
        ? `${runShort(p)} failed at ${c.stage(String(p.stage))}: ${c.reason(String(p.errorCode ?? 'stage_error'), failureParams(p.errorParams))}`
        : `${runShort(p)} failed`,
    run_cancelled: (p) =>
      p.reason === 'pr_closed' ? 'Run cancelled: PR closed' : `${runShort(p)} cancelled`,
    run_retried: (p, c) =>
      p.stage ? `Retry from ${c.stage(String(p.stage))} started` : `${runShort(p)} retried`,
    github_comment_posted: (p) => `GitHub comment posted: "${String(p.body ?? '')}"`,
    findings_decided: (p) =>
      `Decided ${plural(n(p.count), 'finding')}: ${DECISIONS[String(p.decision)] ?? String(p.decision)}${
        p.reason ? ` (${String(p.reason)})` : ''
      }`,
    decision_undone: (p) =>
      `Undid the decision on ${plural(n(p.count), 'finding')}: ${DECISIONS[String(p.decision)] ?? String(p.decision)}`,
    task_linked: (p) => `Linked ClickUp task ${String(p.taskId ?? '')}`,
    follow_up_created: (p) =>
      `Created ClickUp follow-up ${String(p.taskId ?? '')} for a deferred finding`,
    patch_ready: (p) =>
      `Patch revision ${Number(p.revision) || 1} ready: ${Number(p.fixed) || 0} of ${Number(p.total) || 0} fixed`,
    patch_file_edited: (p) => `Edited ${String(p.path ?? '')} in the patch`,
    patch_file_reverted: (p) => `Reverted ${String(p.path ?? '')} in the patch`,
    patch_revise_requested: (p) =>
      `Asked for a new patch revision${p.note ? `: ${String(p.note)}` : ''}`,
    ...autofix.timeline,
    pr_level_changed: (p) => `PR level set to ${prLevel(p.to)} (was ${prLevel(p.from)})`,
    sensitive_approved: (p) => `Approved ${plural(n(p.count), 'sensitive file')}`,
    sensitive_sent_back: (p) =>
      `Sent back ${plural(n(p.count), 'sensitive file')}: "${String(p.comment ?? '')}"`,
    questions_answered: (p) => `Answered ${plural(n(p.count), 'question')}`,
    review_saved: (p) => `Review saved: ${reviewCounts(n(p.worth), n(p.notWorth))}`,
    author_notified: (p) =>
      `Notified ${String(p.authorName ?? 'the author')} in ClickUp (${String(p.taskId ?? '')})`,
    alert_raised: alerts.timeline.raised,
    alert_delivery: alerts.timeline.delivery,
    alert_dismissed: alerts.timeline.dismissed,
  } as Record<string, (p: Params, c: TimelineContext) => string>,
  unknownEntry: (kind: string) => kind.replaceAll('_', ' '),
};
