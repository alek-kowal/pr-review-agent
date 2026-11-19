import { createFileRoute } from '@tanstack/react-router';
import { ExperimentsPage } from '@/features/trials/ExperimentsPage.tsx';

export const Route = createFileRoute('/settings/experiments/')({
  component: ExperimentsPage,
});
