import { Progress } from '@/components/ui/progress.tsx';
import { copy } from '@/copy/index.ts';
import type { StatusResponse } from '@/lib/api-types.ts';

/** Today's spend against the daily budget; nothing without a budget. */
export function SpendBar({
  status,
  className,
}: {
  status: Pick<StatusResponse, 'todaySpendUsd' | 'dailyBudgetUsd'>;
  className?: string;
}) {
  const budget = status.dailyBudgetUsd;
  if (budget === null) return null;
  const percent = Math.min(100, (status.todaySpendUsd / budget) * 100);
  const tone = percent >= 100 ? 'bg-bad-solid' : percent > 80 ? 'bg-warn-solid' : undefined;
  return (
    <Progress
      value={Math.round(percent)}
      aria-label={copy.status.spentPercent}
      className={className}
      indicatorClassName={tone}
    />
  );
}
