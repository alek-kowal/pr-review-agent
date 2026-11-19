import { createFileRoute } from '@tanstack/react-router';
import { Overview } from '@/features/insights/Overview.tsx';

export const Route = createFileRoute('/insights/')({
  component: OverviewRoute,
});

function OverviewRoute() {
  return <Overview search={Route.useSearch()} />;
}
