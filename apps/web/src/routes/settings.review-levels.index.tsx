import { createFileRoute } from '@tanstack/react-router';
import { ReviewLevelsPage } from '@/features/levels/ReviewLevelsPage.tsx';

export const Route = createFileRoute('/settings/review-levels/')({
  component: ReviewLevelsPage,
});
