import { createFileRoute } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';

export const Route = createFileRoute('/insights/trust')({
  component: () => <p className="text-text-3">{copy.insights.later}</p>,
});
