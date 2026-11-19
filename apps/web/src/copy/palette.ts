// Copy for the command palette (S-17-T5), the keyboard shortcuts (S-17-T6) and the theme
// (S-17-T7).

export const palette = {
  trigger: 'Search',
  triggerHint: 'Search pull requests, people, settings and actions',
  title: 'Command palette',
  description: 'Search pull requests, people, settings pages and actions.',
  placeholder: 'Search PRs, people, settings, actions…',
  groups: {
    pullRequests: 'Pull requests',
    people: 'People',
    settings: 'Settings',
    actions: 'Actions',
  },
  searching: 'Searching…',
  empty: 'No results.',
  number: (n: number) => `#${n}`,
  login: (login: string) => `@${login}`,
  /** A person item opens the board filtered to them. */
  personHint: 'Show their pull requests',
  /** Actions, by registry id (`features/palette/actions.ts`). */
  actions: {
    shortcuts: 'Show keyboard shortcuts',
    theme: 'Toggle theme',
    pause: 'Pause or resume the agents…',
    startReview: 'Start review on this PR…',
  } as Record<string, string>,
};

export const shortcuts = {
  title: 'Keyboard shortcuts',
  description: 'Keys work when you are not typing and no dialog is open.',
  close: 'Close',
  groups: { global: 'Anywhere', findings: 'Findings tab' },
  /** Key names as shown in Kbd hints. */
  keys: { mod: '⌘', then: 'then' },
  items: {
    palette: 'Open the command palette',
    search: 'Search',
    help: 'Show keyboard shortcuts',
    goPrs: 'Go to Pull requests',
    goActivity: 'Go to Activity',
    next: 'Next finding',
    previous: 'Previous finding',
    expand: 'Expand or collapse',
    select: 'Select',
    worth: 'Opinion draft: Worth implementing',
    notWorth: 'Opinion draft: Not worth it',
    implement: 'Implement…',
    reject: 'Reject…',
    defer: 'Defer…',
    confirm: 'Confirm the open form',
  },
};

export const theme = {
  toggle: 'Toggle theme',
  toDark: 'Switch to the dark theme',
  toLight: 'Switch to the light theme',
};
