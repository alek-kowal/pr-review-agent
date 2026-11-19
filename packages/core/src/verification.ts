import './reasons/verification.ts';
import type { Evidence, Finding, RoundResult } from './model.ts';
import { reason, type Check, type Reason } from './reason.ts';
import type { Severity, Verdict } from './vocabulary.ts';

/** What the verifier returns for one finding. */
export interface VerifierCheck {
  findingId: string;
  /** The verifier's own verdict, before quotes and reproduction are applied. */
  verdict: Verdict;
  evidence: Evidence[];
}

export interface VerificationResult {
  verdict: Verdict;
  reason: Reason;
}

/** Reads a file at the reviewed commit; null when it does not exist. */
export type ReadFile = (path: string) => string | null | undefined;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Every quote must exist word for word in its file (whitespace-insensitive). No evidence, or one
 * missing quote, makes the finding Not proven.
 */
export function checkQuotes(check: VerifierCheck, readFile: ReadFile): VerificationResult {
  const { findingId, evidence } = check;
  if (evidence.length === 0) {
    return { verdict: 'not_proven', reason: reason('no_evidence', { findingId }) };
  }
  for (const { file, quote } of evidence) {
    const content = readFile(file);
    const wanted = squash(quote);
    if (content == null || wanted === '' || !squash(content).includes(wanted)) {
      return { verdict: 'not_proven', reason: reason('quote_missing', { findingId, file, quote }) };
    }
  }
  return {
    verdict: check.verdict,
    reason: reason('quotes_found', { findingId, count: evidence.length }),
  };
}

/** Reproduction exit codes: the script's result beats the verifier's own verdict. */
export const REPRO_EXIT = { reproduced: 0, notReproduced: 3 } as const;

export function applyReproduction(check: VerifierCheck, exitCode: number): VerificationResult {
  const params = { findingId: check.findingId, exitCode, agentVerdict: check.verdict };
  if (exitCode === REPRO_EXIT.reproduced) {
    return { verdict: 'confirmed', reason: reason('repro_reproduced', params) };
  }
  if (exitCode === REPRO_EXIT.notReproduced) {
    return { verdict: 'refuted', reason: reason('repro_not_reproduced', params) };
  }
  return { verdict: 'not_proven', reason: reason('repro_broken', params) };
}

export const MAX_REPRO_REPAIRS = 1;

/** A broken reproduction gets exactly one repair attempt. */
export function reproRepairAllowed(repairsDone: number): Check {
  return repairsDone < MAX_REPRO_REPAIRS
    ? {
        ok: true,
        reason: reason('repro_repair_allowed', {
          attempt: repairsDone + 1,
          max: MAX_REPRO_REPAIRS,
        }),
      }
    : {
        ok: false,
        reason: reason('repro_repairs_used', { used: repairsDone, max: MAX_REPRO_REPAIRS }),
      };
}

/** What the verifier sees of a finding. It never sees the proposed fix. */
export interface VerifierInput {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
}

export function verifierInput(finding: Finding): VerifierInput {
  const { id, severity, title, file, line, scenario } = finding;
  return { id, severity, title, file, line, scenario };
}

/** Only the current round is verified. */
export function findingsToVerify(
  rounds: readonly RoundResult[],
  currentRoundId: string,
): Finding[] {
  return rounds.find((r) => r.id === currentRoundId)?.findings ?? [];
}

/** The newest completed round decides which findings are current. Rounds are in start order. */
export function currentFindings(rounds: readonly RoundResult[]): Finding[] {
  return rounds.findLast((r) => r.status === 'completed')?.findings ?? [];
}
