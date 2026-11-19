import { createFileRoute } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { PlaceholderPage } from '@/features/shell/PlaceholderPage.tsx';

export const Route = createFileRoute('/activity')({
  component: ActivityPage,
});

function ActivityPage() {
  return <PlaceholderPage title={copy.activity.title} text={copy.activity.placeholder} />;
}
