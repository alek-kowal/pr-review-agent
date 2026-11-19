import { createFileRoute } from '@tanstack/react-router';
import { InsightsLayout } from '@/features/insights/InsightsLayout.tsx';
import { validateInsightsSearch } from '@/features/insights/search.ts';

export const Route = createFileRoute('/insights')({
  validateSearch: validateInsightsSearch,
  component: InsightsLayout,
});
