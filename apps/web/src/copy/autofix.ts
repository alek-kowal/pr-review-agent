// Copy for level 5 autofix and its shadow log: one phrase per autofix reason code (the banner's
// "Autofix waiting: <reason>"), and the Timeline rows of attempts, pushes and shadow entries.
import { plural } from './format.ts';

type Params = Record<string, unknown>;
const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const sha7 = (sha: unknown) => String(sha ?? '').slice(0, 7);

/** Why autofix holds, as a phrase that follows "Autofix waiting: ". */
const reasons: Record<string, (p: Params) => string> = {
  patch_touches_sensitive: () => 'patch touches a sensitive file',
  open_questions: (p) => `${plural(n(p.count), 'question')} to answer`,
  unsure_verdicts: (p) => `${plural(n(p.count), 'finding')} not confirmed`,
  fix_needs_decision: (p) =>
    n(p.count) === 1
      ? '1 fix needs a person to choose'
      : `${n(p.count)} fixes need a person to choose`,
  one_way_door_hold: () => 'a One-way door needs a person',
  autofix_paused: () => 'the agent is paused',
  autofix_budget_reached: () => 'the daily budget is reached',
  head_moved_since_review: (p) => `${plural(n(p.commits), 'new commit')} since the review`,
  auto_patches_used: (p) => `automatic patches used (${n(p.used)} of ${n(p.max)})`,
  fork_read_only: () => 'fork PRs stay read-only',
  autofix_trial: () => 'a trial never changes the PR',
  head_moved_since_patch: () => 'the head moved after the patch was made',
  not_all_fixed: (p) => `${n(p.fixed)} of ${n(p.total)} findings fixed`,
  reproductions_fail: (p) => `${n(p.failed)} of ${n(p.total)} reproductions still fail`,
  autofix_findings_changed: () => 'someone decided a finding meanwhile',
  // Refusals of the push job and of the implementer start.
  head_moved: (p) => `the head moved to ${sha7(p.headSha)}`,
  pr_closed: () => 'the PR is closed',
  run_active: () => 'another run is active',
  patch_not_ready: () => 'the patch is no longer ready',
  patch_empty: () => 'the patch changes no file',
  no_implement_decisions: () => 'no finding to implement',
  implement_below_level: () => 'the implementer is off at this level',
};

/** One autofix reason (`{ code, params }`) as a phrase; an unknown code reads as its words. */
export function autofixReason(value: unknown): string {
  const { code, params } = (value ?? {}) as { code?: unknown; params?: unknown };
  const key = String(code ?? '');
  const phrase = reasons[key];
  return phrase ? phrase((params ?? {}) as Params) : key.replaceAll('_', ' ');
}

export const autofix = {
  reason: autofixReason,
  waiting: (reason: unknown) => `Autofix waiting: ${autofixReason(reason)}`,
  /** Timeline rows (actor: the bot). */
  timeline: {
    autofix_started: () => 'Autofix started by pr-review-agent',
    autofix_pushed: (p: Params) => `Autofix pushed ${sha7(p.sha)}`,
    autofix_waiting: (p: Params) => `Autofix waiting: ${autofixReason(p.reason)}`,
    autofix_shadow: (p: Params) => {
      if (p.decision === 'would_wait')
        return `Level 5 would have waited: ${autofixReason(p.reason)}`;
      const fixed = `Level 5 would have fixed ${n(p.fixed)} of ${n(p.total)}`;
      return p.decision === 'would_push' ? `${fixed} and pushed` : fixed;
    },
    patch_pushed: (p: Params) =>
      `Pushed ${sha7(p.sha)}${p.branch ? ` to ${String(p.branch)}` : ''}`,
    patch_push_refused: (p: Params) => `Push refused: ${autofixReason(p.reason)}`,
  },
};
