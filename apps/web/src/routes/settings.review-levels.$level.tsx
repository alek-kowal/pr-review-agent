import { createFileRoute } from '@tanstack/react-router';
import { LevelPage } from '@/features/levels/LevelPage.tsx';

export const Route = createFileRoute('/settings/review-levels/$level')({
  component: LevelRoute,
});

function LevelRoute() {
  const { level } = Route.useParams();
  return <LevelPage key={level} level={Number(level)} />;
}
