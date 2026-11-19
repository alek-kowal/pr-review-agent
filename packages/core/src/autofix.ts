import './reasons/autofix.ts';
import type { SensitivePattern } from './change-type.ts';
import { needsDecision } from './findings.ts';
import { DEFAULT_AUTOFIX_MAX_PATCHES, FEATURE_ON_FROM } from './levels.ts';
import { matchSensitiveFiles } from './limits.ts';
import type { Finding } from './model.ts';
import { reason, type Reason } from './reason.ts';
import type { ChangeType, LevelNumber } from './vocabulary.ts';

export interface AutofixInput {
  level: LevelNumber;
  fork: boolean;
  /** The round is a trial ("Try on a PR"), which never changes the PR (FR-081). */
  trial?: boolean;
  paused: boolean;
  budgetReached: boolean;
  changeType: ChangeType | null;
  findings: readonly Finding[];
  openQuestions: number;
  commitsSinceReview?: number;
  /** Automatic patches already made in this chain. The limit is per chain, not per PR. */
  autoPatchesInChain: number;
  /** N, the only editable condition (level 5 setting); 2 by default. */
  maxAutoPatches?: number;
}

export interface AutofixDecision {
  /** Only level 5 and above act; below that the same check feeds the shadow log. */
  enabled: boolean;
  /** Every condition holds: level 5 starts the implementer (or would have, in the shadow log). */
  go: boolean;
  /** The findings autofix would implement. */
  findingIds: string[];
  reasons: Reason[];
}

/** A finding needs work when it waits for a decision or is decided Implement and not resolved. */
const needsWork = (f: Finding) =>
  needsDecision(f).needed || (f.decision === 'implement' && f.resolved !== true);

/** Whether level 5 may start the implementer by itself after a round, and why not. */
export function autofixDecision(input: AutofixInput): AutofixDecision {
  const max = input.maxAutoPatches ?? DEFAULT_AUTOFIX_MAX_PATCHES;
  const work = input.findings.filter(needsWork);
  const enabled = input.level >= FEATURE_ON_FROM.autofix;
  // Nothing to fix is not a hold: the shadow log must not count the PR as held by anything else.
  if (work.length === 0) {
    return { enabled, go: false, findingIds: [], reasons: [reason('nothing_to_fix')] };
  }
  const holds: Reason[] = [];

  if (input.fork) holds.push(reason('fork_read_only'));
  if (input.trial) holds.push(reason('autofix_trial'));
  if (input.openQuestions > 0) holds.push(reason('open_questions', { count: input.openQuestions }));
  const unsure = work.filter((f) => f.verdict !== 'confirmed').length;
  if (unsure) holds.push(reason('unsure_verdicts', { count: unsure }));
  const choice = work.filter((f) => f.remedy !== 'obvious').length;
  if (choice) holds.push(reason('fix_needs_decision', { count: choice }));
  if (input.changeType === 'one_way_door') holds.push(reason('one_way_door_hold'));
  if (input.commitsSinceReview) {
    holds.push(reason('head_moved_since_review', { commits: input.commitsSinceReview }));
  }
  if (input.autoPatchesInChain >= max) {
    holds.push(reason('auto_patches_used', { used: input.autoPatchesInChain, max }));
  }
  if (input.paused) holds.push(reason('autofix_paused'));
  if (input.budgetReached) holds.push(reason('autofix_budget_reached'));

  return {
    enabled,
    go: holds.length === 0,
    findingIds: work.map((f) => f.id),
    reasons: holds.length ? holds : [reason('autofix_conditions_met', { count: work.length })],
  };
}

export interface PatchResult {
  /** The PR head the patch was made on. */
  baseSha: string;
  /** The findings the implementer was asked to fix. */
  findingIds: readonly string[];
  fixedFindingIds: readonly string[];
  reproductions: { total: number; passed: number };
  files: readonly string[];
}

/**
 * Whether the implementer's patch may be pushed without a person: every finding fixed, every
 * reproduction passing on the patched code, no sensitive file touched, and the PR head still the
 * one the patch was made on (a push is never forced).
 */
export function pushByItself(
  patch: PatchResult,
  pr: { headSha: string; sensitivePatterns?: readonly SensitivePattern[] },
): { go: boolean; reasons: Reason[] } {
  const holds: Reason[] = [];
  if (patch.baseSha !== pr.headSha) holds.push(reason('head_moved_since_patch'));
  const fixed = patch.findingIds.filter((id) => patch.fixedFindingIds.includes(id)).length;
  if (fixed < patch.findingIds.length) {
    holds.push(reason('not_all_fixed', { fixed, total: patch.findingIds.length }));
  }
  const { total, passed } = patch.reproductions;
  if (passed < total) holds.push(reason('reproductions_fail', { failed: total - passed, total }));
  for (const hit of matchSensitiveFiles(patch.files, pr.sensitivePatterns ?? [])) {
    holds.push(reason('patch_touches_sensitive', { path: hit.path, pattern: hit.pattern }));
  }
  return {
    go: holds.length === 0,
    reasons: holds.length ? holds : [reason('push_conditions_met')],
  };
}
