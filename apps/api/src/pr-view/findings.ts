// The Findings tab: the newest completed round's findings with their current decisions, its
// questions and what it did not check.
import { DECISIONS, needsDecision, SEVERITIES, VERDICTS } from '@pra/core';
import {
  commitsSinceRun,
  coreFinding,
  FOLLOW_UP_STATUSES,
  verificationsOfRun,
  type CurrentDecision,
  type Executor,
  type FindingVerification,
  type PrStateLoad,
} from '@pra/db';
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
  /**
   * How the Verify stage reached the verdict (level 3 and up): the core reason code, the
   * verifier's own words and the reproduction that decided. Null when Verify did not run.
   */
  verification: z
    .object({
      reason: ReasonSchema,
      verifierReason: z.string().nullable(),
      reproduction: z
        .object({
          exitCode: z.number().int().nullable(),
          timedOut: z.boolean(),
          outputTail: z.string().nullable(),
          /** Whether the one repair attempt produced the script that decided. */
          repaired: z.boolean(),
        })
        .nullable(),
    })
    .nullable(),
  /** Sent back with a decision, so a decision made in between conflicts (409). */
  version: z.number().int(),
  decision: DecisionSchema.nullable(),
  /** Whether it waits for a decision, and why (core `needsDecision`). */
  needsDecision: z.object({ needed: z.boolean(), reason: ReasonSchema }),
  /** The head SHA of the round that found it (FR-045). */
  sourceSha: z.string(),
  /** Commits on the PR's head since that SHA; 0 while the head has not moved. */
  commitsBehind: z.number().int().nonnegative(),
  /** The newest fix check of a finding decided Implement; null before one ran. */
  fix: z.object({ resolved: z.boolean(), reason: z.string(), runId: z.number().int() }).nullable(),
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
  /** Below level 3: how many findings no verifier checked. Null at level 3 and up. */
  unchecked: z.number().int().nullable(),
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

type VerificationView = z.output<typeof FindingSchema>['verification'];

function verificationView(row: FindingVerification | undefined): VerificationView {
  if (!row) return null;
  const ran = row.sandboxRuns > 0 || row.exitCode !== null || row.timedOut;
  return {
    reason: { code: row.reason.code, params: row.reason.params },
    verifierReason: row.verifierReason,
    reproduction: ran
      ? {
          exitCode: row.exitCode,
          timedOut: row.timedOut,
          outputTail: row.outputTail,
          repaired: row.repaired,
        }
      : null,
  };
}

/** Verdicts start at level 3; a lower round's findings are all unchecked. */
const VERIFYING_LEVEL = 3;

/** The Findings tab for a loaded PR, with the findings round's verification rows. */
export async function loadFindingsView(db: Executor, load: PrStateLoad): Promise<FindingsView> {
  const verifications = load.findingsRound
    ? await verificationsOfRun(db, load.findingsRound.id)
    : [];
  return findingsView(load, verifications);
}

export function findingsView(
  load: PrStateLoad,
  verifications: readonly FindingVerification[] = [],
): FindingsView {
  const run = load.findingsRound;
  if (!run) return { round: null, findings: [], questions: [], notChecked: [], unchecked: null };
  const byFinding = new Map(verifications.map((v) => [v.findingId, v]));
  const commitsBehind = commitsSinceRun(load.pullRequest, run);
  return {
    round: {
      id: run.id,
      number: run.roundNo,
      level: roundLevel(run),
      finishedAt: iso(run.finishedAt),
    },
    findings: load.findings.map((f) => {
      const decision = load.decisions.get(f.id);
      const fix = load.fixChecks.get(f.id);
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
        verification: verificationView(byFinding.get(f.id)),
        version: f.version,
        decision: decision ? decisionView(decision) : null,
        needsDecision: needsDecision(coreFinding(f, decision, fix)),
        sourceSha: run.headSha,
        commitsBehind,
        fix: fix ? { resolved: fix.resolved, reason: fix.reason, runId: fix.runId } : null,
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
    unchecked:
      run.level.number < VERIFYING_LEVEL
        ? load.findings.filter((f) => f.verdict === 'unchecked').length
        : null,
  };
}
