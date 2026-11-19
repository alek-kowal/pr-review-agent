import { createFileRoute } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { PlaceholderPage } from '@/features/shell/PlaceholderPage.tsx';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  return <PlaceholderPage title={copy.settings.title} text={copy.settings.placeholder} />;
}
