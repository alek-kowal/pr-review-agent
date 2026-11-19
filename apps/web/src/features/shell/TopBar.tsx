import { Link } from '@tanstack/react-router';
import { Activity, ChartColumn, GitPullRequest, Settings, type LucideIcon } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import { CommandPalette } from '@/features/palette/CommandPalette.tsx';
import { ThemeToggle } from '@/features/theme/ThemeToggle.tsx';
import { StatusChip } from './StatusChip.tsx';

type NavPath = '/prs' | '/activity' | '/insights' | '/settings';

const NAV: ReadonlyArray<{ to: NavPath; label: string; icon: LucideIcon }> = [
  { to: '/prs', label: copy.nav.pullRequests, icon: GitPullRequest },
  { to: '/activity', label: copy.nav.activity, icon: Activity },
  { to: '/insights', label: copy.nav.insights, icon: ChartColumn },
  { to: '/settings', label: copy.nav.settings, icon: Settings },
];

// Approved structure (docs/03-design-decisions.md): product name, the four sections, search (the
// command palette, S-17-T5), the theme toggle (S-17-T7), the status chip, no account menu.
export function TopBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <Link to="/prs" className="mr-1 flex shrink-0 items-center gap-2 text-text no-underline">
          <Logo />
          <span className="font-heading text-[15px] font-semibold">{copy.app.name}</span>
        </Link>
        <nav
          aria-label={copy.nav.label}
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-text-2 no-underline hover:bg-inset hover:text-text aria-[current=page]:bg-brand-bg aria-[current=page]:font-semibold aria-[current=page]:text-brand-text"
            >
              <Icon aria-hidden="true" className="size-[15px]" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 shrink items-center gap-2">
          <CommandPalette />
          <ThemeToggle />
          <StatusChip />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--brand)" />
      <path
        d="M6 8.5h5.5a3 3 0 0 1 3 3V17"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="6.5" cy="8.5" r="2" fill="#fff" />
      <circle cx="14.5" cy="17" r="2.2" fill="var(--coral)" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}
