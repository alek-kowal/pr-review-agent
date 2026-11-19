import { createFileRoute } from '@tanstack/react-router';
import { PrList } from '@/features/prs/PrList.tsx';

// The root route passes the raw URL search on, so an invalid value must be cleared explicitly.
type PrsSearch = { repo?: string | undefined };

export const Route = createFileRoute('/prs')({
  validateSearch: (search: Record<string, unknown>): PrsSearch => ({
    repo: typeof search.repo === 'string' && search.repo !== '' ? search.repo : undefined,
  }),
  component: PullRequestsPage,
});

function PullRequestsPage() {
  const { repo } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PrList
      repo={repo}
      onRepoChange={(next) => void navigate({ search: next ? { repo: next } : {} })}
    />
  );
}
