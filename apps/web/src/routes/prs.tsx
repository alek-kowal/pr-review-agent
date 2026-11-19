import { createFileRoute } from '@tanstack/react-router';
import { PrList } from '@/features/prs/PrList.tsx';

type PrsSearch = { repo?: string };

export const Route = createFileRoute('/prs')({
  validateSearch: (search: Record<string, unknown>): PrsSearch =>
    typeof search.repo === 'string' && search.repo !== '' ? { repo: search.repo } : {},
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
