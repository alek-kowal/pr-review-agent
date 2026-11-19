import { Link, Outlet } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';

const TABS = [
  { id: 'overview', to: '/insights' },
  { id: 'cost', to: '/insights/cost' },
  { id: 'quality', to: '/insights/quality' },
  { id: 'trust', to: '/insights/trust' },
] as const;

/** Insights: the page title, its four tabs as links that keep the filters, and the open tab. */
export function InsightsLayout() {
  const t = copy.insights;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-xl font-semibold">{t.title}</h1>
      <nav aria-label={t.tabsLabel} className="flex gap-1 border-b border-divider">
        {TABS.map(({ id, to }) => (
          <Link
            key={id}
            to={to}
            search={(prev) => prev}
            activeOptions={{ exact: true, includeSearch: false }}
            className="-mb-px inline-flex h-9 items-center border-b-2 border-transparent px-3 text-[13px] font-medium text-text-2 no-underline hover:text-text aria-[current=page]:border-brand aria-[current=page]:font-semibold aria-[current=page]:text-text"
          >
            {t.tabs[id]}
          </Link>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
