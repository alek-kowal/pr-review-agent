import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TopBar } from '@/features/shell/TopBar.tsx';
import type { RouterContext } from '../router.ts';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-svh">
      <TopBar />
      <main className="px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
