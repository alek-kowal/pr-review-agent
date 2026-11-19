import { createFileRoute } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { PlaceholderPage } from '@/features/shell/PlaceholderPage.tsx';

export const Route = createFileRoute('/prs')({
  component: PullRequestsPage,
});

function PullRequestsPage() {
  return <PlaceholderPage title={copy.prs.title} text={copy.prs.placeholder} />;
}
