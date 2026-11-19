import type { FindingView } from '@/lib/api-types.ts';

/** The findings filter shows only from this many findings up (FR-036). */
export const FILTER_FROM = 7;

export type FindingFilterKey = 'all' | 'todo' | 'done';

/**
 * Whether a finding still needs a decision. A nit never needs one and a refuted finding needs
 * none. Decisions arrive in P-08, which adds "and has no decision" here.
 */
export const needsDecision = (f: FindingView): boolean =>
  f.severity !== 'nit' && f.verdict !== 'refuted';

/** Whether someone decided the finding. Always false until decisions arrive (P-08). */
export const isDecided: (f: FindingView) => boolean = () => false;

export const FINDING_FILTERS: readonly {
  key: FindingFilterKey;
  matches: (f: FindingView) => boolean;
}[] = [
  { key: 'all', matches: () => true },
  { key: 'todo', matches: needsDecision },
  { key: 'done', matches: isDecided },
];
