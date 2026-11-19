import { createFileRoute } from '@tanstack/react-router';
import { CostTab } from '@/features/insights/CostTab.tsx';

export const Route = createFileRoute('/insights/cost')({
  component: Tab,
});

function Tab() {
  return <CostTab search={Route.useSearch()} />;
}
