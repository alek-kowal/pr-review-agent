import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { MainActionProps } from '@/features/pr/slots.ts';
import { stageName } from '@/lib/reasons.ts';
import { useRetryRun } from './retry.ts';

const t = copy.runs.retry;

/**
 * The Stage failed banner's main action (S-09-T2): "Retry from <stage>" retries the PR's latest
 * round, which is the failed one. Unsigned, recorded "by hand".
 */
export function RetryAction({ repo, number, view, action }: MainActionProps) {
  const retry = useRetryRun(repo, number);
  const runId = view.latestRound?.id;
  const stage = stageName(action.stage ?? view.latestRound?.error?.stage ?? '');

  return (
    <Button
      size="sm"
      title={t.hint}
      disabled={action.disabled !== null || runId === undefined || retry.isPending}
      onClick={() => runId !== undefined && retry.mutate(runId)}
    >
      <RotateCcw aria-hidden="true" className="size-[13px]" />
      {t.action(stage)}
    </Button>
  );
}
