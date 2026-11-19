import { X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { MainActionProps } from '@/features/pr/slots.ts';
import type { InProgressRun } from '@/lib/api-types.ts';
import { useCancelRun } from './cancel.ts';

const t = copy.runs.cancel;

/**
 * The banner's `cancel` action while a round is queued or running (S-09-T4), or while the
 * implementer is fixing (S-13-T5): cancels the PR's active run. Unsigned, recorded "by hand".
 */
export function CancelAction({ view, action }: MainActionProps) {
  const cancel = useCancelRun();
  const round = view.latestRound;
  const activeId =
    view.implementer.activeRun?.id ??
    (round && (round.status === 'queued' || round.status === 'running') ? round.id : null);

  return (
    <Button
      size="sm"
      variant="outline"
      title={t.hint}
      disabled={
        action.disabled !== null || activeId === null || cancel.isPending || cancel.isSuccess
      }
      onClick={() => activeId !== null && cancel.mutate(activeId)}
    >
      <X aria-hidden="true" className="size-[13px]" />
      {t.action}
    </Button>
  );
}

/** Cancel at the end of an Activity In progress row. */
export function CancelRowAction({ run }: { run: InProgressRun }) {
  const cancel = useCancelRun();
  const name = copy.runs.kinds[run.kind]?.(run.roundNumber) ?? copy.runs.unknownKind(run.kind);
  return (
    <Button
      size="sm"
      variant="ghost"
      title={t.hint}
      aria-label={t.rowLabel(name)}
      disabled={cancel.isPending || cancel.isSuccess}
      onClick={() => cancel.mutate(run.id)}
    >
      {t.action}
    </Button>
  );
}
