import type { Verdict } from '../vocabulary.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    no_evidence: { findingId: string };
    quote_missing: { findingId: string; file: string; quote: string };
    quotes_found: { findingId: string; count: number };
    /** The reproduction exited 0: the bug happens. */
    repro_reproduced: { findingId: string; exitCode: number; agentVerdict: Verdict };
    /** The reproduction exited 3: the bug does not happen. */
    repro_not_reproduced: { findingId: string; exitCode: number; agentVerdict: Verdict };
    /** Any other exit: the script itself is broken. */
    repro_broken: { findingId: string; exitCode: number; agentVerdict: Verdict };
    repro_repair_allowed: { attempt: number; max: number };
    repro_repairs_used: { used: number; max: number };
  }
}
