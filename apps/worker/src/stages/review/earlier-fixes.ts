// Reviewer context provider (S-07-T3, US-05): round 1 of a new chain lists the earlier findings
// decided Implement and not resolved yet, and the reviewer reports in `fixes` whether this head
// resolves them.
import { fixTargetsOfRun, type FindingRow } from '@pra/db';
import type { ReviewerContextProvider } from './context.ts';

export const EARLIER_FIXES_TITLE = 'Earlier findings decided Implement';

export const earlierFixesProvider: ReviewerContextProvider = {
  key: 'earlier_fixes',
  async sections({ deps, run }) {
    if ((run.roundNo ?? 1) > 1) return [];
    const { findings } = await fixTargetsOfRun(deps.db, run);
    if (findings.length === 0) return [];
    return [{ title: EARLIER_FIXES_TITLE, body: earlierFixesBody(findings) }];
  },
};

export function earlierFixesBody(findings: readonly FindingRow[]): string {
  const lines = findings.map(
    (f) => `- id ${f.id}: ${f.title} (${f.file}${f.line ? `:${f.line}` : ''}). ${f.scenario}`,
  );
  return [
    'The team decided to implement these findings of an earlier review. For each id, report in',
    '`fixes` whether the code at this head resolves it, with one or two sentences why. Do not',
    'repeat them as new findings.',
    '',
    ...lines,
  ].join('\n');
}
