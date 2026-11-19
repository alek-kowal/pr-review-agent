import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Toaster } from '@/components/ui/sonner.tsx';
import { TopBar } from '@/features/shell/TopBar.tsx';
import { ShortcutsDialog } from '@/features/shortcuts/ShortcutsDialog.tsx';
import { useLiveUpdates } from '@/live/useLiveUpdates.ts';
import type { RouterContext } from '../router.ts';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  useLiveUpdates();
  return (
    <div className="min-h-svh">
      <TopBar />
      <main className="px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <ShortcutsDialog />
      <Toaster />
    </div>
  );
}
