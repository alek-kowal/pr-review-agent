import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { MainActionProps } from '@/features/pr/slots.ts';
import { openStatusChip } from '@/features/shell/open-status-chip.ts';

/**
 * The banner's `resume` action on a PR queued by a pause or the daily budget (S-10-T6): it opens
 * the status chip, where Resume and the budget are signed.
 */
export function ResumeAction({ action }: MainActionProps) {
  return (
    <Button size="sm" disabled={action.disabled !== null} onClick={openStatusChip}>
      <Play aria-hidden="true" className="size-[13px]" />
      {copy.nextStep.actions.resume}
    </Button>
  );
}
