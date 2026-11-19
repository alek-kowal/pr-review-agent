import { createFileRoute } from '@tanstack/react-router';
import { ConnectRepositoryPage } from '@/features/repositories/ConnectRepositoryPage.tsx';

export const Route = createFileRoute('/settings/repositories/connect')({
  validateSearch: (search: Record<string, unknown>): { fullName: string } => ({
    fullName: typeof search.fullName === 'string' ? search.fullName : '',
  }),
  component: ConnectRoute,
});

function ConnectRoute() {
  const { fullName } = Route.useSearch();
  return <ConnectRepositoryPage fullName={fullName} />;
}
