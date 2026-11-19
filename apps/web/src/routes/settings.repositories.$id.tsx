import { createFileRoute } from '@tanstack/react-router';
import { RepositoryPage } from '@/features/repositories/RepositoryPage.tsx';

export const Route = createFileRoute('/settings/repositories/$id')({
  component: RepositoryRoute,
});

function RepositoryRoute() {
  const { id } = Route.useParams();
  return <RepositoryPage id={Number(id)} />;
}
