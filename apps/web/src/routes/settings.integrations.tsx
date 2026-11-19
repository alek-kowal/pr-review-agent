import { createFileRoute } from '@tanstack/react-router';
import { IntegrationsPage } from '@/features/integrations/IntegrationsPage.tsx';

export const Route = createFileRoute('/settings/integrations')({
  component: IntegrationsPage,
});
