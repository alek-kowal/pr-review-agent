import { createFileRoute } from '@tanstack/react-router';
import { SettingsLayout } from '@/features/settings/SettingsLayout.tsx';
import { settingsPages } from '@/features/settings/registry.ts';

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  return <SettingsLayout pages={settingsPages} />;
}
