// The Findings tab: the newest completed round's findings with their current decisions, its
// questions and what it did not check.
import { DECISIONS, needsDecision, SEVERITIES, VERDICTS } from '@pra/core';
import { coreFinding, FOLLOW_UP_STATUSES, type CurrentDecision, type PrStateLoad } from '@pra/db';
import { z } from 'zod/v4';
import { iso, ReasonSchema, roundLevel, RoundLevelSchema } from './round.ts';

const timestamp = z.iso.datetime({ offset: true });

export const DecisionSchema = z.object({
  /** The batch that decided it; Undo takes this id. */
  batchId: z.number().int(),
  decision: z.enum(DECISIONS),
  reason: z.string().nullable(),
  /** The signer, named even after they left the team. */
  signedBy: z.object({ id: z.string(), name: z.string() }),
  decidedAt: timestamp,
  /** Defer to ClickUp only: the follow-up task, or why there is none (S-06-T5). */
  followUp: z
    .object({
      /** Null until the follow-up job ran. */
      status: z.enum(FOLLOW_UP_STATUSES).nullable(),
      taskId: z.string().nullable(),
      url: z.string().nullable(),
      error: ReasonSchema.nullable(),
    })
    .nullable(),
});

export const FindingSchema = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  severity: z.enum(SEVERITIES),
  title: z.string(),
  file: z.string(),
  line: z.number().int().nullable(),
  scenario: z.string(),
  suggestion: z.string(),
  verdict: z.enum(VERDICTS),
  evidence: z.array(
    z.object({ file: z.string(), line: z.number().int().nullable(), quote: z.string() }),
  ),
  /** Sent back with a decision, so a decision made in between conflicts (409). */
  version: z.number().int(),
  decision: DecisionSchema.nullable(),
  /** Whether it waits for a decision, and why (core `needsDecision`). */
  needsDecision: z.object({ needed: z.boolean(), reason: ReasonSchema }),
});

export const QuestionSchema = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  text: z.string(),
  options: z.array(z.string()),
  recommended: z.number().int().nullable(),
  why: z.string().nullable(),
});

export const FindingsResponse = z.object({
  /** The latest completed round the findings come from; null when no round completed yet. */
  round: z
    .object({
      id: z.number().int(),
      number: z.number().int().nullable(),
      level: RoundLevelSchema,
      finishedAt: timestamp.nullable(),
    })
    .nullable(),
  findings: z.array(FindingSchema),
  questions: z.array(QuestionSchema),
  notChecked: z.array(z.string()),
});
export type FindingsView = z.output<typeof FindingsResponse>;

export function decisionView(decision: CurrentDecision): z.output<typeof DecisionSchema> {
  return {
    batchId: decision.batchId,
    decision: decision.decision,
    reason: decision.reason,
    signedBy: { id: decision.signedBy, name: decision.signerName },
    decidedAt: decision.decidedAt.toISOString(),
    followUp: decision.followUp,
  };
}

export function findingsView(load: PrStateLoad): FindingsView {
  const run = load.reviewedRound;
  if (!run) return { round: null, findings: [], questions: [], notChecked: [] };
  return {
    round: {
      id: run.id,
      number: run.roundNo,
      level: roundLevel(run),
      finishedAt: iso(run.finishedAt),
    },
    findings: load.findings.map((f) => {
      const decision = load.decisions.get(f.id);
      return {
        id: f.id,
        ordinal: f.ordinal,
        severity: f.severity,
        title: f.title,
        file: f.file,
        line: f.line,
        scenario: f.scenario,
        suggestion: f.suggestion,
        verdict: f.verdict,
        evidence: f.evidence,
        version: f.version,
        decision: decision ? decisionView(decision) : null,
        needsDecision: needsDecision(coreFinding(f, decision)),
      };
    }),
    questions: load.questions.map((q) => ({
      id: q.id,
      ordinal: q.ordinal,
      text: q.text,
      options: q.options,
      recommended: q.recommended,
      why: q.why,
    })),
    notChecked: run.notChecked,
  };
}
