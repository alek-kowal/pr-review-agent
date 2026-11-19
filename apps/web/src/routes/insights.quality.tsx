import { createFileRoute } from '@tanstack/react-router';
import { QualityTab } from '@/features/insights/QualityTab.tsx';

export const Route = createFileRoute('/insights/quality')({
  component: Tab,
});

function Tab() {
  return <QualityTab search={Route.useSearch()} />;
}
