import { createFileRoute } from '@tanstack/react-router';
import { Board } from '@/features/board/Board.tsx';
import { parseBoardSearch, setFilters, type BoardFilters } from '@/features/board/filters.ts';

// Every filter lives in the address (S-17-T4), so a reload or a shared link keeps it.
export const Route = createFileRoute('/prs')({
  validateSearch: (search: Record<string, unknown>): BoardFilters => parseBoardSearch(search),
  component: BoardPage,
});

function BoardPage() {
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Board
      filters={filters}
      onFiltersChange={(patch) =>
        void navigate({ search: (prev) => setFilters({ ...prev, ...patch }) })
      }
    />
  );
}
