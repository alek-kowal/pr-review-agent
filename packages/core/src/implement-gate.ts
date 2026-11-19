import './reasons/implement.ts';
import './reasons/autofix.ts';
import './reasons/pr-state.ts';
import './reasons/rounds.ts';
import { toFix } from './findings.ts';
import { FEATURE_ON_FROM } from './levels.ts';
import type { Finding, PrSnapshot } from './model.ts';
import { reason, type Reason } from './reason.ts';

/** What the Implement gate reads from a PR. */
export type ImplementGatePr = Pick<PrSnapshot, 'fork' | 'level' | 'activeRun'>;

export type ImplementGate =
  { allowed: true; findingIds: string[] } | { allowed: false; reason: Reason };

/**
 * Why the PR itself refuses Implement with agent, whatever its findings: a fork stays read-only,
 * and below level 4 the implementer is off. null when the PR allows it.
 */
export function implementBlock(pr: Pick<PrSnapshot, 'fork' | 'level'>): Reason | null {
  if (pr.fork) return reason('fork_read_only');
  const need = FEATURE_ON_FROM.implement;
  if (pr.level < need) return reason('implement_below_level', { level: pr.level, need });
  return null;
}

/**
 * Whether the implementer may start on this PR. It takes every finding decided Implement and not
 * resolved yet. The fork check comes first, as defense in depth next to the fork run policy.
 */
export function canImplementWithAgent(
  pr: ImplementGatePr,
  findings: readonly Finding[],
): ImplementGate {
  const block = implementBlock(pr);
  if (block) return { allowed: false, reason: block };
  const open = toFix(findings);
  if (!open.length) return { allowed: false, reason: reason('no_implement_decisions') };
  if (pr.activeRun) {
    const { kind, status } = pr.activeRun;
    return { allowed: false, reason: reason('run_active', { kind, status }) };
  }
  return { allowed: true, findingIds: open.map((f) => f.id) };
}

export type PatchReproduction = 'pass' | 'fail' | 'not_run';

/** One line for a patch's reproductions: any fail fails, else any pass passes, else not run. */
export function patchReproductions(results: readonly PatchReproduction[]): PatchReproduction {
  if (results.includes('fail')) return 'fail';
  return results.includes('pass') ? 'pass' : 'not_run';
}
