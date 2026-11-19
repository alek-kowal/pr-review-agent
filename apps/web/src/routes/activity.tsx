import { createFileRoute } from '@tanstack/react-router';
import { ActivityPage } from '@/features/activity/ActivityPage.tsx';

export const Route = createFileRoute('/activity')({
  component: ActivityPage,
});
