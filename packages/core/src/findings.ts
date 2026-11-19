import './reasons/findings.ts';
import type { Finding, Question, RoundResult } from './model.ts';
import { reason, type Need, type Reason } from './reason.ts';

/**
 * Whether a finding waits for a person's decision. Only Blocking and Worth fixing findings that are
 * not refuted need one; nits are optional and never block.
 */
export function needsDecision(finding: Finding): Need {
  if (finding.resolved === true) return { needed: false, reason: reason('fix_resolved') };
  if (finding.decision) {
    return { needed: false, reason: reason('decided', { decision: finding.decision }) };
  }
  if (finding.verdict === 'refuted') return { needed: false, reason: reason('refuted') };
  if (finding.severity === 'nit') return { needed: false, reason: reason('nit_optional') };
  const { severity } = finding;
  return finding.verdict === 'unchecked'
    ? { needed: true, reason: reason('unchecked_needs_person', { severity }) }
    : { needed: true, reason: reason('needs_decision', { severity }) };
}

/** Findings that wait for a decision, in the reviewer's order. */
export const toDecide = (findings: readonly Finding[]): Finding[] =>
  findings.filter((f) => needsDecision(f).needed);

/** Findings decided Implement and not resolved yet, nits included: each blocks until resolved. */
export const toFix = (findings: readonly Finding[]): Finding[] =>
  findings.filter((f) => f.decision === 'implement' && f.resolved !== true);

export const openQuestions = (questions: readonly Question[]): Question[] =>
  questions.filter((q) => !q.answered);

export interface FindingsOutcome {
  needsPerson: boolean;
  /** The first thing a person must do; questions come first. */
  reason: Reason;
  /** Everything that needs a person, in the order it must be done. */
  reasons: Reason[];
  toDecide: string[];
  toFix: string[];
}

/** What a round's result asks of a person: questions, then decisions, sensitive files, fixes. */
export function findingsOutcome(round: RoundResult): FindingsOutcome {
  const questions = openQuestions(round.questions).length;
  const decide = toDecide(round.findings);
  const fix = toFix(round.findings);
  const sensitive =
    round.sensitive && round.sensitive.status !== 'approved' ? round.sensitive.files.length : 0;

  const reasons: Reason[] = [];
  if (questions) reasons.push(reason('questions_waiting', { count: questions }));
  if (decide.length) reasons.push(reason('findings_to_decide', { count: decide.length }));
  if (sensitive) reasons.push(reason('sensitive_files_need_person', { count: sensitive }));
  if (fix.length) reasons.push(reason('fixes_open', { count: fix.length }));

  return {
    needsPerson: reasons.length > 0,
    reason: reasons[0] ?? reason('round_clean'),
    reasons,
    toDecide: decide.map((f) => f.id),
    toFix: fix.map((f) => f.id),
  };
}
