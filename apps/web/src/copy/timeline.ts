// Copy for the PR Timeline tab: the time summary and one sentence per entry kind.
import { shortSha } from './nextStep.ts';
import { money, plural } from './format.ts';

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

const DECISIONS: Record<string, string> = {
  implement: 'implement',
  reject: 'reject',
  defer: 'defer to ClickUp',
};

/** Helpers an entry sentence may need: stage and failure names. */
export interface TimelineContext {
  stage: (key: string) => string;
  reason: (code: string) => string;
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
    pr_closed: () => 'PR closed',
    pr_merged: () => 'PR merged',
    run_started: (p) => `${runName(p)} started`,
    run_finished: (p) => `${runShort(p)} finished`,
    run_failed: (p, c) =>
      p.stage
        ? `${runShort(p)} failed at ${c.stage(String(p.stage))}: ${c.reason(String(p.errorCode ?? 'stage_error'))}`
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
  } as Record<string, (p: Params, c: TimelineContext) => string>,
  unknownEntry: (kind: string) => kind.replaceAll('_', ' '),
};
