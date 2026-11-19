// The Settings page registry. Only built pages are registered, so the sidebar (and the command
// palette's Settings group) never shows a page that does not exist yet. A new Settings page adds
// its route file `routes/settings.<id>.tsx` and one entry to `settingsPages`.
import { FolderGit2, Plug, Users, type LucideIcon } from 'lucide-react';

export const SETTINGS_GROUPS = ['general', 'repositories', 'review', 'improve', 'system'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/** The approved pages of each group, in sidebar order (docs/03-design-decisions.md). */
export const SETTINGS_PAGE_IDS = {
  general: ['budget', 'models', 'team', 'integrations', 'alerts'],
  repositories: ['repositories'],
  review: ['review-levels', 'instructions', 'pipeline'],
  improve: ['experiments', 'learning'],
  system: ['audit'],
} as const satisfies Record<SettingsGroup, readonly string[]>;

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[SettingsGroup][number];

export type SettingsPageEntry = {
  id: SettingsPageId;
  /** The page's route path, for example `/settings/team`. */
  to: string;
  icon: LucideIcon;
};

/** Built Settings pages; the label comes from `copy.settings.pages[id]`. */
export const settingsPages: readonly SettingsPageEntry[] = [
  { id: 'team', to: '/settings/team', icon: Users },
  { id: 'integrations', to: '/settings/integrations', icon: Plug },
  { id: 'repositories', to: '/settings/repositories', icon: FolderGit2 },
];

export const groupOf = (id: SettingsPageId): SettingsGroup =>
  SETTINGS_GROUPS.find((group) => (SETTINGS_PAGE_IDS[group] as readonly string[]).includes(id))!;

/** Registered pages by group, in the approved order; groups without a page are left out. */
export function sidebarGroups(
  pages: readonly SettingsPageEntry[],
): { group: SettingsGroup; pages: SettingsPageEntry[] }[] {
  return SETTINGS_GROUPS.map((group) => ({
    group,
    pages: (SETTINGS_PAGE_IDS[group] as readonly SettingsPageId[]).flatMap((id) =>
      pages.filter((page) => page.id === id),
    ),
  })).filter((entry) => entry.pages.length > 0);
}
