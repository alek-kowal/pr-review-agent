import { createFileRoute } from '@tanstack/react-router';
import { PrPage } from '@/features/pr/PrPage.tsx';
import { DEFAULT_PR_TAB, isPrTab } from '@/features/pr/tabs.ts';

type PrSearch = { tab?: string };

export const Route = createFileRoute('/pr/$repo/$number')({
  validateSearch: (search: Record<string, unknown>): PrSearch =>
    isPrTab(search.tab) ? { tab: search.tab } : {},
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
