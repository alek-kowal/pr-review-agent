import { createFileRoute } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { PlaceholderPage } from '@/features/shell/PlaceholderPage.tsx';

export const Route = createFileRoute('/insights')({
  component: InsightsPage,
});

function InsightsPage() {
  return <PlaceholderPage title={copy.insights.title} text={copy.insights.placeholder} />;
}
