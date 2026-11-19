// The Findings tab: the newest completed round's findings with their current decisions, its
// questions and what it did not check.
import {
  DECISIONS,
  decisionLabelNames,
  needsDecision,
  SEVERITIES,
  VERDICTS,
  type UsualDecider,
} from '@pra/core';
import {
  commitsSinceRun,
  coreFinding,
  FOLLOW_UP_STATUSES,
  OPINIONS,
  type CurrentAnswer,
  type OpinionRow,
  verificationsOfRun,
  type CurrentDecision,
  type Executor,
  type FindingVerification,
  type PrStateLoad,
} from '@pra/db';
import { z } from 'zod/v4';
import { iso, ReasonSchema, roundLevel, RoundLevelSchema } from './round.ts';
import { AuthorSchema, authorView } from './state.ts';

const timestamp = z.iso.datetime({ offset: true });

export const DecisionSchema = z.object({
  /** The batch that decided it; Undo takes this id. */
  batchId: z.number().int(),
  decision: z.enum(DECISIONS),
  reason: z.string().nullable(),
  /** The signer, named even after they left the team. */
  signedBy: z.object({ id: z.string(), name: z.string() }),
  decidedAt: timestamp,
  /** The PR author when it was decided (S-08-T5, FR-041). */
  author: AuthorSchema,
  /**
   * The names its label shows: "Rejected by Tomek (author: Kasia)", or only the signer when the
   * author signed ("Rejected by Kasia (author)").
   */
  label: z.object({ signer: z.string(), author: z.string().nullable() }),
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
  /** Who usually decides it (core `usuallyDecidedBy`); null when it needs no decision. */
  usuallyDecidedBy: AuthorSchema.nullable(),
  /** Whether it waits for a decision, and why (core `needsDecision`). */
  needsDecision: z.object({ needed: z.boolean(), reason: ReasonSchema }),
  /** The head SHA of the round that found it (FR-045). */
  sourceSha: z.string(),
  /** Commits on the PR's head since that SHA; 0 while the head has not moved. */
  commitsBehind: z.number().int().nonnegative(),
  /** The newest fix check of a finding decided Implement; null before one ran. */
  fix: z.object({ resolved: z.boolean(), reason: z.string(), runId: z.number().int() }).nullable(),
  /** Signed opinions, oldest first (FR-037); one per signer. */
  opinions: z.array(
    z.object({
      id: z.number().int(),
      signedBy: z.object({ id: z.string(), name: z.string() }),
      value: z.enum(OPINIONS),
      comment: z.string().nullable(),
      /** The round it was given in; shown as "from round N" when carried. */
      fromRound: z.number().int(),
      /** Copied from the matching finding of an earlier round (FR-043). */
      carried: z.boolean(),
      at: timestamp,
    }),
  ),
});

export function opinionView(opinion: OpinionRow): z.output<typeof FindingSchema>['opinions'][0] {
  return {
    id: opinion.id,
    signedBy: { id: opinion.signedBy, name: opinion.signerName },
    value: opinion.value,
    comment: opinion.comment,
    fromRound: opinion.fromRound,
    carried: opinion.carriedFromId !== null,
    at: opinion.createdAt.toISOString(),
  };
}

export const QuestionSchema = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  text: z.string(),
  options: z.array(z.string()),
  recommended: z.number().int().nullable(),
  why: z.string().nullable(),
  /** The current answer; null while the question is open. Sent back as `expectedAnswerId`. */
  answer: z
    .object({
      id: z.number().int(),
      /** The picked option; null for an own answer. */
      option: z.number().int().nullable(),
      text: z.string(),
      signedBy: z.object({ id: z.string(), name: z.string() }),
      savedAt: timestamp,
    })
    .nullable(),
});

export function answerView(answer: CurrentAnswer): z.output<typeof QuestionSchema>['answer'] {
  return {
    id: answer.id,
    option: answer.option,
    text: answer.text,
    signedBy: { id: answer.signedBy, name: answer.signerName },
    savedAt: answer.savedAt.toISOString(),
  };
}

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

/**
 * A current decision for the api. `prAuthor` (the PR's author now) stands in for decisions stored
 * before the author was kept on them.
 */
export function decisionView(
  decision: CurrentDecision,
  prAuthor: UsualDecider,
): z.output<typeof DecisionSchema> {
  const signedBy = { id: decision.signedBy, name: decision.signerName };
  const author = decision.author ?? prAuthor;
  return {
    batchId: decision.batchId,
    decision: decision.decision,
    reason: decision.reason,
    signedBy,
    decidedAt: decision.decidedAt.toISOString(),
    author,
    label: decisionLabelNames(signedBy, author),
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
  const author = authorView(load);
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
      const needs = needsDecision(coreFinding(f, decision, fix));
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
        decision: decision ? decisionView(decision, author) : null,
        usuallyDecidedBy: needs.needed ? author : null,
        needsDecision: needs,
        sourceSha: run.headSha,
        commitsBehind,
        fix: fix ? { resolved: fix.resolved, reason: fix.reason, runId: fix.runId } : null,
        opinions: (load.opinions.get(f.id) ?? []).map(opinionView),
      };
    }),
    questions: load.questions.map((q) => ({
      id: q.id,
      ordinal: q.ordinal,
      text: q.text,
      options: q.options,
      recommended: q.recommended,
      why: q.why,
      answer: load.answers.has(q.id) ? answerView(load.answers.get(q.id)!) : null,
    })),
    notChecked: run.notChecked,
    unchecked:
      run.level.number < VERIFYING_LEVEL
        ? load.findings.filter((f) => f.verdict === 'unchecked').length
        : null,
  };
}
