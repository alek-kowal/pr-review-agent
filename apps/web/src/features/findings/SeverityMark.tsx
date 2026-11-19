import type { Severity } from '@pra/core';
import { copy } from '@/copy/index.ts';

const COLORS: Record<Severity, string> = {
  blocking: 'bg-bad-solid',
  worth_fixing: 'bg-warn-solid',
  nit: 'bg-border-strong',
};

/** The small square that marks a severity. */
export function SeverityMark({
  severity,
  className = '',
  labelled = true,
}: {
  severity: Severity;
  className?: string;
  /** Off where the severity is already written next to it. */
  labelled?: boolean;
}) {
  return (
    <span
      {...(labelled
        ? { role: 'img', 'aria-label': copy.findings.severities[severity].one }
        : { 'aria-hidden': true })}
      className={`inline-block size-2 shrink-0 rounded-[2px] ${COLORS[severity]} ${className}`}
    />
  );
}
