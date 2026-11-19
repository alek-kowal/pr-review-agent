import { Link, Outlet } from '@tanstack/react-router';
import { copy } from '@/copy/index.ts';
import { sidebarGroups, type SettingsPageEntry } from './registry.ts';

/** Settings: the sidebar of registered pages beside the open page. */
export function SettingsLayout({ pages }: { pages: readonly SettingsPageEntry[] }) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <SettingsSidebar pages={pages} />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export function SettingsSidebar({ pages }: { pages: readonly SettingsPageEntry[] }) {
  return (
    <nav
      aria-label={copy.settings.navLabel}
      className="flex shrink-0 flex-col gap-4 md:sticky md:top-20 md:w-52"
    >
      {sidebarGroups(pages).map(({ group, pages: groupPages }) => (
        <div key={group} className="flex flex-col gap-0.5">
          <h2 className="px-2.5 pb-1 font-heading text-xs font-semibold text-text-3">
            {copy.settings.groups[group]}
          </h2>
          {groupPages.map(({ id, to, icon: Icon }) => (
            <Link
              key={id}
              to={to}
              className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-text-2 no-underline hover:bg-inset hover:text-text aria-[current=page]:bg-brand-bg aria-[current=page]:font-semibold aria-[current=page]:text-brand-text"
            >
              <Icon aria-hidden="true" className="size-[15px]" />
              {copy.settings.pages[id]}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
