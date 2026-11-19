import { createFileRoute } from '@tanstack/react-router';
import { RepositoriesPage } from '@/features/repositories/RepositoriesPage.tsx';

export const Route = createFileRoute('/settings/repositories/')({
  component: RepositoriesPage,
});
