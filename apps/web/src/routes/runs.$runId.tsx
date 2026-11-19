import { createFileRoute } from '@tanstack/react-router';
import { RunPage } from '@/features/runs/RunPage.tsx';
import { isRunTab, type RunTab } from '@/features/runs/tabs.ts';

// The root route passes the raw URL search on, so an invalid value must be cleared explicitly.
type RunSearch = { tab?: RunTab | undefined };

export const Route = createFileRoute('/runs/$runId')({
  validateSearch: (search: Record<string, unknown>): RunSearch => ({
    tab: isRunTab(search.tab) ? search.tab : undefined,
  }),
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runId } = Route.useParams();
  const { tab = 'stages' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RunPage
      key={runId}
      runId={runId}
      tab={tab}
      onTabChange={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  );
}
