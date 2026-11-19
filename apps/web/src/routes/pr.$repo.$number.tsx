import { createFileRoute } from '@tanstack/react-router';
import { PrPage } from '@/features/pr/PrPage.tsx';
import { DEFAULT_PR_TAB, isPrTab } from '@/features/pr/tabs.ts';

// The root route passes the raw URL search on, so an invalid value must be cleared explicitly.
type PrSearch = { tab?: string | undefined };

export const Route = createFileRoute('/pr/$repo/$number')({
  validateSearch: (search: Record<string, unknown>): PrSearch => ({
    tab: isPrTab(search.tab) ? search.tab : undefined,
  }),
  component: PullRequestPage,
});

function PullRequestPage() {
  const { repo, number } = Route.useParams();
  const { tab = DEFAULT_PR_TAB } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PrPage
      key={`${repo}#${number}`}
      repo={repo}
      number={number}
      tab={tab}
      onTabChange={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  );
}
