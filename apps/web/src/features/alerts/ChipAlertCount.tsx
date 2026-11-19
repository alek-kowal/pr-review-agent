import { BellRing } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import type { StatusChipProps } from '@/features/shell/status-chip-slots.ts';

/** The status chip's active alert count (S-18): a red bell and the number; nothing at 0. */
export function ChipAlertCount({ status }: StatusChipProps) {
  const count = status.activeAlertCount;
  if (!count) return null;
  return (
    <span
      data-chip-alerts={count}
      title={copy.alerts.count(count)}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-bad-bg px-1.5 text-xs text-bad tabular-nums"
    >
      <BellRing aria-hidden="true" className="size-3" />
      {count}
    </span>
  );
}
