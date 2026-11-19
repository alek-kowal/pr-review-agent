import { createFileRoute, redirect } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { settingsPages, sidebarGroups } from '@/features/settings/registry.ts';
import { PlaceholderPage } from '@/features/shell/PlaceholderPage.tsx';

export const Route = createFileRoute('/settings/')({
  // Settings opens on the first page of the sidebar.
  beforeLoad: () => {
    const first = sidebarGroups(settingsPages)[0]?.pages[0];
    if (first) throw redirect({ to: first.to, replace: true });
  },
  component: NoSettingsPage,
});

function NoSettingsPage() {
  return <PlaceholderPage title={copy.settings.title} text={copy.settings.placeholder} />;
}
