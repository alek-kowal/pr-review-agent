import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';

/**
 * Opens Run detail: "Run details" after the round line and on the Timeline; the run's name in
 * Activity.
 */
export function RunDetailsLink({
  runId,
  className,
  children,
}: {
  runId: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: String(runId) }}
      className={className ?? 'text-brand-text'}
    >
      {children ?? copy.runs.runDetails}
    </Link>
  );
}
