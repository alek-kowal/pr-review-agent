import { createFileRoute } from '@tanstack/react-router';
import { InstructionsPage } from '@/features/instructions/InstructionsPage.tsx';

export const Route = createFileRoute('/settings/instructions/')({
  component: InstructionsPage,
});
