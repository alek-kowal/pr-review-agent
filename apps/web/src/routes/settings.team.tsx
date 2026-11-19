import { createFileRoute } from '@tanstack/react-router';
import { TeamPage } from '@/features/team/TeamPage.tsx';

export const Route = createFileRoute('/settings/team')({
  component: TeamPage,
});
