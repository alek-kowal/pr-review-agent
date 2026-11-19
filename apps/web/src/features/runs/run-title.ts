import { copy } from '@/copy/index.ts';
import type { RunDetail } from '@/lib/api-types.ts';

/** "Round 2 of 3", or the run kind for runs that are not rounds. */
export function runTitle(detail: Pick<RunDetail, 'label' | 'run'>): string {
  const p = detail.label?.params;
  if (p) return `Round ${Number(p.roundNumber)} of ${Number(p.max)}`;
  const kind = copy.runs.kinds[detail.run.kind];
  return kind ? kind(null) : copy.runs.unknownKind(detail.run.kind);
}
