import './reasons/limits.ts';
import type { SensitivePattern } from './change-type.ts';
import { matchGlob } from './glob.ts';
import { reason, type Reason } from './reason.ts';
import { SEVERITIES, severityRank, type ChangeType, type Severity } from './vocabulary.ts';

/** A round never reports more findings than this, whatever the settings say. */
export const MAX_FINDINGS = 7;

export interface ReviewLimits {
  maxFindings: number;
  maxQuestions: number;
  /** Severities the reviewer may report. */
  severities: readonly Severity[];
  /** Which findings Verify checks for this change type: all, only Blocking ones, or none. */
  verify: VerifyScope;
}

export type VerifyScope = 'all' | 'blocking' | 'none';

/** What a review level may narrow. A level narrows only the fields it sets. */
export type LevelLimits = Partial<
  Pick<ReviewLimits, 'maxFindings' | 'maxQuestions' | 'severities'>
>;

/** Built-in caps per change type; `none` applies when no change type is known (level 1). */
export const CHANGE_TYPE_LIMITS: Readonly<Record<ChangeType | 'none', ReviewLimits>> = {
  none: { maxFindings: 7, maxQuestions: 3, severities: SEVERITIES, verify: 'all' },
  uses_existing: {
    maxFindings: 3,
    maxQuestions: 0,
    severities: ['blocking', 'worth_fixing'],
    verify: 'blocking',
  },
  changes_behaviour: { maxFindings: 7, maxQuestions: 3, severities: SEVERITIES, verify: 'all' },
  one_way_door: { maxFindings: 7, maxQuestions: 3, severities: SEVERITIES, verify: 'all' },
};

/** The change type's caps, narrowed by the fields the level sets. */
export function limitsFor(
  level: LevelLimits,
  changeType: ChangeType | null,
  table: Readonly<Record<ChangeType | 'none', ReviewLimits>> = CHANGE_TYPE_LIMITS,
): ReviewLimits {
  const base = table[changeType ?? 'none'];
  return {
    maxFindings: Math.min(base.maxFindings, level.maxFindings ?? Infinity),
    maxQuestions: Math.min(base.maxQuestions, level.maxQuestions ?? Infinity),
    severities: level.severities
      ? base.severities.filter((s) => level.severities!.includes(s))
      : base.severities,
    verify: base.verify,
  };
}

export interface ReviewOutput<F extends { severity: Severity }, Q> {
  findings: F[];
  questions: Q[];
}

export interface Enforced<F extends { severity: Severity }, Q> extends ReviewOutput<F, Q> {
  dropped: { severity: number; overLimit: number; questions: number };
  reasons: Reason[];
}

/**
 * Applies the limits after the reviewer's output: drops disallowed severities and questions, then
 * cuts to `maxFindings` (never above 7) from the least severe end, keeping the reviewer's order.
 */
export function enforce<F extends { severity: Severity }, Q>(
  output: ReviewOutput<F, Q>,
  limits: Pick<ReviewLimits, 'maxFindings' | 'maxQuestions' | 'severities'>,
): Enforced<F, Q> {
  const reasons: Reason[] = [];
  const max = Math.max(0, Math.min(limits.maxFindings, MAX_FINDINGS));
  if (limits.maxFindings > MAX_FINDINGS) {
    reasons.push(reason('max_findings_clamped', { requested: limits.maxFindings, max }));
  }

  const allowed = output.findings.filter((f) => limits.severities.includes(f.severity));
  for (const severity of SEVERITIES) {
    const dropped = output.findings.filter(
      (f) => f.severity === severity && !limits.severities.includes(severity),
    ).length;
    if (dropped) reasons.push(reason('severity_not_allowed', { severity, dropped }));
  }

  const keep = new Set(
    allowed
      .map((finding, index) => ({ finding, index }))
      .sort(
        (a, b) =>
          severityRank(a.finding.severity) - severityRank(b.finding.severity) || a.index - b.index,
      )
      .slice(0, max)
      .map(({ finding }) => finding),
  );
  const findings = allowed.filter((f) => keep.has(f));
  const overLimit = allowed.length - findings.length;
  if (overLimit) reasons.push(reason('over_max_findings', { max, dropped: overLimit }));

  const maxQuestions = Math.max(0, limits.maxQuestions);
  const questions = output.questions.slice(0, maxQuestions);
  const droppedQuestions = output.questions.length - questions.length;
  if (droppedQuestions) {
    reasons.push(
      maxQuestions === 0
        ? reason('questions_not_allowed', { dropped: droppedQuestions })
        : reason('over_max_questions', { max: maxQuestions, dropped: droppedQuestions }),
    );
  }

  return {
    findings,
    questions,
    dropped: {
      severity: output.findings.length - allowed.length,
      overLimit,
      questions: droppedQuestions,
    },
    reasons,
  };
}

/**
 * Whether Verify checks a finding. The change type's scope decides by severity: `all` checks
 * every finding, `blocking` only Blocking ones, `none` nothing. A skipped finding stays unchecked.
 */
export function skipVerification(
  changeType: ChangeType | null,
  limits: Pick<ReviewLimits, 'verify'>,
): (finding: { severity: Severity }) => { skip: boolean; reason: Reason } {
  const scope = limits.verify;
  return ({ severity }) => {
    if (scope === 'all' || (scope === 'blocking' && severity === 'blocking')) {
      return { skip: false, reason: reason('verify_on', { changeType }) };
    }
    return { skip: true, reason: reason('verify_off_for_change_type', { changeType, scope }) };
  };
}

export interface SensitiveMatch {
  path: string;
  pattern: string;
  /** The repository setting's explanation, shown to the person who approves. */
  reason: string;
}

/** Files that match a sensitive pattern, each with the first pattern it matches. */
export function matchSensitiveFiles(
  files: readonly string[],
  patterns: readonly SensitivePattern[],
): SensitiveMatch[] {
  return files.flatMap((path) => {
    const hit = patterns.find((p) => matchGlob(path, p.pattern));
    return hit ? [{ path, pattern: hit.pattern, reason: hit.reason }] : [];
  });
}
