import { createFileRoute } from '@tanstack/react-router';
import { TrustTab } from '@/features/insights/TrustTab.tsx';

export const Route = createFileRoute('/insights/trust')({
  component: Tab,
});

function Tab() {
  return <TrustTab search={Route.useSearch()} />;
}
