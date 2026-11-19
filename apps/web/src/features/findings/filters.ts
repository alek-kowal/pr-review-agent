import type { FindingView } from '@/lib/api-types.ts';

/** The findings filter shows only from this many findings up (FR-036). */
export const FILTER_FROM = 7;

export type FindingFilterKey = 'all' | 'todo' | 'done';

/** Whether a finding still needs a decision: core's rule, sent by the api with each finding. */
export const needsDecision = (f: FindingView): boolean => f.needsDecision.needed;

/** Whether someone decided the finding (a decision that was undone does not count). */
export const isDecided = (f: FindingView): boolean => f.decision !== null;

export const FINDING_FILTERS: readonly {
  key: FindingFilterKey;
  matches: (f: FindingView) => boolean;
}[] = [
  { key: 'all', matches: () => true },
  { key: 'todo', matches: needsDecision },
  { key: 'done', matches: isDecided },
];
