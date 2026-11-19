import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { useDecideFocus } from './decide-focus.ts';
import type { MainActionProps } from './slots.ts';

/** The Decide main action: takes the reader to the first finding that needs a decision. */
export function DecideAction({ action }: MainActionProps) {
  const { focusFirstUndecided } = useDecideFocus();
  return (
    <Button size="sm" disabled={action.disabled !== null} onClick={focusFirstUndecided}>
      {copy.nextStep.actions.decide}
    </Button>
  );
}
