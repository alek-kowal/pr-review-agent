import { Link } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';

/** "Run details": opens Run detail; used after the round line, in Activity and on the Timeline. */
export function RunDetailsLink({ runId, className }: { runId: number; className?: string }) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: String(runId) }}
      className={className ?? 'text-brand-text'}
    >
      {copy.runs.runDetails}
    </Link>
  );
}
