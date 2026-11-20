// Copy for Settings → Audit log (S-21-T7).

export const audit = {
  title: 'Audit log',
  affects:
    'nothing: a record of every signed settings change and every change the bot made by itself.',
  loading: 'Loading the audit log…',
  filters: {
    label: 'Audit log filters',
    search: 'Search',
    searchPlaceholder: 'e.g. verifier, budget, level',
    area: 'Area',
    allAreas: 'All areas',
    who: 'Who',
    everyone: 'Everyone',
    from: 'From',
    to: 'To',
    clear: 'Clear filters',
  },
  count: (n: number, more: boolean) =>
    `${n} ${n === 1 ? 'entry' : 'entries'}${more ? ' so far' : ''}`,
  empty: 'No change matches. Clear a filter to see more.',
  none: 'No settings change yet.',
  tableLabel: 'Settings changes',
  columns: { when: 'When', who: 'Who', area: 'Area', summary: 'What changed' },
  bot: 'Bot',
  hand: 'By hand',
  formerMember: 'A former member',
  expand: 'Show before and after',
  collapse: 'Hide before and after',
  before: 'Before',
  after: 'After',
  nothing: 'Nothing',
  loadMore: 'Load more',
  loadingMore: 'Loading…',
  /** Settings areas by their `settings_changes.area`; an unknown area shows as stored. */
  areas: {
    models: 'Models',
    levels: 'Review levels',
    team: 'Team',
    repositories: 'Repositories',
    integrations: 'Integrations',
    budget: 'Budget',
    alerts: 'Alerts',
    instructions: 'Instructions',
    stage_files: 'Stage files',
    experiments: 'Experiments',
    learning: 'Learning',
  } as Record<string, string>,
  summary: {
    created: (entity: string) => `Added ${entity}`,
    removed: (entity: string) => `Removed ${entity}`,
    changed: (keys: string[]) =>
      keys.length === 0
        ? 'No visible change'
        : keys.length <= 3
          ? `Changed ${keys.join(', ')}`
          : `Changed ${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`,
    value: 'Changed the value',
  },
};
