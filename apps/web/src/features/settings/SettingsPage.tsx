import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';

type Props = {
  title: string;
  /** What the page's settings change, after "Affects:". Every Settings page has one. */
  affects: string;
  /** Page-level actions, for example "Add a person". */
  actions?: ReactNode;
  children: ReactNode;
};

/** The frame of one Settings page: title, the "Affects:" line and the page's actions. */
export function SettingsPage({ title, affects, actions, children }: Props) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-xl font-semibold">{title}</h1>
          <p className="mt-1 flex max-w-[90ch] items-start gap-1.5 text-sm text-text-2">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-text-3" />
            <span>
              <span className="font-medium">{copy.settings.affects}</span> {affects}
            </span>
          </p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
