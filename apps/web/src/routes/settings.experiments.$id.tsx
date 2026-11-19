import { createFileRoute } from '@tanstack/react-router';
import { ComparePage } from '@/features/trials/ComparePage.tsx';

export const Route = createFileRoute('/settings/experiments/$id')({
  component: CompareRoute,
});

function CompareRoute() {
  const { id } = Route.useParams();
  return <ComparePage id={Number(id)} />;
}
