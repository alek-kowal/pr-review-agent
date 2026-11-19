import { createFileRoute } from '@tanstack/react-router';
import { LearningPage } from '@/features/learning/LearningPage.tsx';

export const Route = createFileRoute('/settings/learning')({
  component: LearningPage,
});
