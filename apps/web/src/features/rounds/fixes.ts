import type { FindingView } from '@/lib/api-types.ts';

/** Findings decided Implement that a fix check (or a new chain's review) answered. */
export const checkedFixes = (findings: readonly FindingView[]) =>
  findings.filter((f) => f.decision?.decision === 'implement' && f.fix !== null);
