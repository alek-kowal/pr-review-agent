import { createFileRoute } from '@tanstack/react-router';
import { PipelinePage } from '@/features/pipeline/PipelinePage.tsx';

/** `repository`: the slug whose stage files the page shows; left out, the Global ones. */
export type PipelineSearch = { repository?: string };

export const Route = createFileRoute('/settings/pipeline')({
  validateSearch: (search: Record<string, unknown>): PipelineSearch => ({
    repository:
      typeof search.repository === 'string' && search.repository.trim() !== ''
        ? search.repository
        : undefined,
  }),
  component: PipelinePage,
});
