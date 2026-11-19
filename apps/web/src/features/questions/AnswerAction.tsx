import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { MainActionProps } from '@/features/pr/slots.ts';

/** The Answer questions main action: opens the Questions tab. */
export function AnswerAction({ repo, number, action }: MainActionProps) {
  if (action.disabled !== null) {
    return (
      <Button size="sm" disabled>
        {copy.nextStep.actions.answer}
      </Button>
    );
  }
  return (
    <Button size="sm" asChild>
      <Link to="/pr/$repo/$number" params={{ repo, number }} search={{ tab: 'questions' }} replace>
        {copy.nextStep.actions.answer}
      </Link>
    </Button>
  );
}
