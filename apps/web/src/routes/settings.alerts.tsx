import { createFileRoute } from '@tanstack/react-router';
import { AlertSettingsPage } from '@/features/alerts-settings/AlertSettingsPage.tsx';

export const Route = createFileRoute('/settings/alerts')({
  component: AlertSettingsPage,
});
