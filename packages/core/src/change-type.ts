import './reasons/change-type.ts';
import { firstMatch, matchGlob } from './glob.ts';
import { reason, type Need, type Reason } from './reason.ts';
import { changeTypeRank, type ChangeType } from './vocabulary.ts';

/** A repository's change-type rules (RepositoryConfig). Patterns use `glob.ts` syntax. */
export interface ChangeTypeRules {
  /** Paths whose changes only use existing parts: docs, tests. */
  usesExistingPaths: string[];
  /** Paths whose changes cannot be undone: migrations, public exports, deploy files. */
  oneWayPaths: string[];
  /** Above this many changed lines, a change is at least Changes behaviour. */
  sizeLines: number;
}

/** A sensitive-file pattern from repository settings, with the reason a person reads. */
export interface SensitivePattern {
  pattern: string;
  reason: string;
}

export interface ClassifyInput {
  files: readonly string[];
  /** Unified diff of the PR; only its changed lines are counted. */
  diff: string;
  rules: ChangeTypeRules;
  /** A change to a sensitive file is a One-way door. */
  sensitivePatterns?: readonly SensitivePattern[];
}

export interface ChangeTypeResult {
  changeType: ChangeType;
  reason: Reason;
}

/** Added and removed lines of a unified diff, without the `+++` and `---` file headers. */
export function changedLines(diff: string): number {
  let lines = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+') || line.startsWith('-')) lines++;
  }
  return lines;
}

/** The floor the path and size rules set. The judge may raise it, never lower it. */
export function classifyChange({
  files,
  diff,
  rules,
  sensitivePatterns = [],
}: ClassifyInput): ChangeTypeResult & { lines: number } {
  const lines = changedLines(diff);
  const result = (changeType: ChangeType, why: Reason) => ({ changeType, reason: why, lines });

  for (const path of files) {
    if (firstMatch(path, rules.oneWayPaths)) {
      return result('one_way_door', reason('path_one_way', { path }));
    }
  }
  for (const path of files) {
    const hit = sensitivePatterns.find((s) => matchGlob(path, s.pattern));
    if (hit)
      return result('one_way_door', reason('sensitive_one_way', { path, pattern: hit.pattern }));
  }
  if (lines > rules.sizeLines) {
    return result(
      'changes_behaviour',
      reason('size_over_threshold', { lines, threshold: rules.sizeLines }),
    );
  }
  const other = files.find((path) => !firstMatch(path, rules.usesExistingPaths));
  return other === undefined
    ? result('uses_existing', reason('paths_uses_existing', { files: files.length }))
    : result('changes_behaviour', reason('paths_change_behaviour', { path: other }));
}

/**
 * Applies the judge to the rules' floor. The judge may only raise the type; a type forced by a
 * person wins, and the result still reports what the rules picked.
 */
export function raiseChangeType(
  base: ChangeType,
  judged: ChangeType | null,
  forced: ChangeType | null,
): ChangeTypeResult & { rulesPicked: ChangeType } {
  const rulesPicked = base;
  if (forced) {
    return {
      changeType: forced,
      reason: reason('forced_by_person', { forced, rules: base }),
      rulesPicked,
    };
  }
  if (!judged)
    return { changeType: base, reason: reason('rules_floor', { changeType: base }), rulesPicked };
  const diff = changeTypeRank(judged) - changeTypeRank(base);
  if (diff > 0) {
    return {
      changeType: judged,
      reason: reason('judge_raised', { from: base, to: judged }),
      rulesPicked,
    };
  }
  return diff === 0
    ? { changeType: base, reason: reason('judge_agreed', { changeType: base }), rulesPicked }
    : {
        changeType: base,
        reason: reason('judge_cannot_lower', { judged, kept: base }),
        rulesPicked,
      };
}

/** A One-way door always needs a person. */
export function needsPerson(changeType: ChangeType): Need {
  return changeType === 'one_way_door'
    ? { needed: true, reason: reason('one_way_needs_person') }
    : { needed: false, reason: reason('change_type_no_person', { changeType }) };
}
