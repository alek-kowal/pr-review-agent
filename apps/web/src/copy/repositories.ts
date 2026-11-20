// Copy for Settings → Repositories and a repository's settings page.

/** Level names by level number (core's `LEVEL_KEYS`). */
export const levelNames: Record<number, string> = {
  1: 'Diff only',
  2: 'With context',
  3: 'Verified',
  4: 'Fix on request',
  5: 'Autofix',
  6: 'Learning',
};

const GLOBAL_LEVEL = 'Global default';

export const repositories = {
  title: 'Repositories',
  affects:
    'per-repository rules: the default review level, sensitive files, ClickUp and how the change type is chosen.',
  loading: 'Loading repositories…',
  empty: 'No repository is connected yet. Connect one the GitHub App can reach.',
  tableLabel: 'Connected repositories',
  columns: {
    repository: 'Repository',
    level: 'Default level',
    clickup: 'ClickUp',
    sensitive: 'Sensitive files',
    branch: 'Default branch',
  },
  level: (n: number) => `${n} · ${levelNames[n] ?? ''}`,
  /** The repository has no own level and uses Settings → Review levels' default. */
  levelGlobal: GLOBAL_LEVEL,
  levelOrGlobal: (n: number | null) =>
    n === null ? GLOBAL_LEVEL : `${n} · ${levelNames[n] ?? ''}`,
  on: 'On',
  actions: 'Actions',
  off: 'Off',
  patterns: (n: number) => (n === 1 ? '1 pattern' : `${n} patterns`),
  open: (name: string) => `Open the settings of ${name}`,
  fromGithubApp: { before: 'Repositories come from the ', link: 'GitHub App', after: '.' },
  connect: {
    label: 'Connect a repository',
    search: 'Search repositories',
    noMatch: 'No repository matches.',
    none: 'Every repository the GitHub App can reach is connected.',
    private: 'private',
    unavailable: (reason: string) => `Cannot list repositories to connect: ${reason}`,
    /** Without the GitHub App (P-28): connect by owner/name. */
    byName: {
      label: 'Repository (owner/name)',
      placeholder: 'owner/name',
      submit: 'Connect…',
      hint: 'The GitHub App is not connected, so type the repository. Public repositories work without a token; private ones need GITHUB_TOKEN.',
      invalid: 'Type the repository as owner/name.',
    },
  },
  page: {
    loading: 'Loading the repository…',
    affects: (name: string) =>
      `every new round on PRs in ${name}. Rounds that are running keep the settings they started with.`,
    back: 'Repositories',
    breadcrumb: 'Breadcrumb',
    saveTitle: (name: string) => `Save settings for ${name}`,
  },
  connectPage: {
    title: (fullName: string) => `Connect ${fullName}`,
    affects: (fullName: string) =>
      `PRs in ${fullName}: once connected, its webhooks start rounds with these settings.`,
    notReachable: (fullName: string) =>
      `The GitHub App cannot reach ${fullName}, or it is already connected. Pick another repository.`,
    /** Without the GitHub App (P-28), after the lookup by name. */
    notFound: (fullName: string) =>
      `GitHub does not show ${fullName}: check the name, or set GITHUB_TOKEN for a private repository.`,
    alreadyConnected: (fullName: string) => `${fullName} is already connected.`,
    checking: (fullName: string) => `Checking ${fullName} on GitHub…`,
    polledAffects: (fullName: string) =>
      `PRs in ${fullName}: once connected, the GitHub poller finds them and starts rounds with these settings.`,
    pending: 'Not connected yet',
    save: 'Connect…',
    dialogTitle: (fullName: string) => `Connect ${fullName}`,
    dialogDescription:
      'The repository is connected with these settings. The change is signed and recorded in the Audit log.',
    confirm: 'Connect',
  },
  sections: {
    general: 'General',
    clickup: 'ClickUp',
    sensitive: 'Sensitive files',
    changeType: 'Change-type rules',
  },
  hints: {
    sensitive:
      'A change to a matching file needs a human OK, even after a clean review. Level 5 never pushes a fix to one by itself.',
    changeType:
      'The change type says how risky a PR is. Rules set the floor; the judge may only raise it.',
  },
  fields: {
    defaultLevel: 'Default review level',
    defaultBranch: 'Default branch',
    fetchCommand: 'Fetch command',
    installCommand: 'Install command',
    largePrLines: 'Large PR above (changed lines)',
    clickupEnabled: 'Use ClickUp for this repository',
    clickupWorkspaceId: 'Workspace ID',
    clickupSpaceId: 'Space ID',
    clickupFollowUpListId: 'Follow-up list ID',
    clickupTaskIdPattern: 'Task ID pattern',
    sensitivePatterns: 'Sensitive files',
    changeTypePaths: 'Change-type paths',
    changeTypeSizeLines: 'Changes behaviour above (changed lines)',
  },
  help: {
    defaultLevel:
      'Used for round 1 when a PR becomes ready. Global default follows Settings → Review levels. Anyone can pick another level for one PR on its page.',
    defaultBranch: 'Merges go here.',
    fetchCommand:
      'Downloads the packages from the lockfile, with network and without PR scripts. Leave empty for no fetch step.',
    installCommand:
      'Installs from the fetched packages with no network, in the Checks stage. Leave empty to skip the install.',
    largePrLines: 'Above this many changed lines a PR is flagged as large.',
    clickupEnabled: 'Off: rounds skip the Task stage for this repository.',
    clickupSpaceId: 'Optional. Narrows the search for the PR’s task to one space.',
    clickupFollowUpListId: 'Optional. Where follow-up tasks go.',
    clickupTaskIdPattern: 'A regular expression for task IDs in branch names and PR titles.',
    changeTypeSizeLines: 'A PR above this size changes behaviour, whatever its paths.',
  },
  placeholders: {
    fetchCommand: 'pnpm fetch --frozen-lockfile --ignore-scripts',
    installCommand: 'pnpm install --offline --frozen-lockfile',
    clickupTaskIdPattern: 'WB-\\d+',
    pattern: 'path/or/**/pattern',
    reason: 'Why does a change here need a human OK?',
  },
  sensitiveTable: {
    label: 'Sensitive file patterns',
    pattern: 'Path pattern',
    reason: 'Reason shown to people',
    add: 'Add a pattern',
    remove: (pattern: string) => `Remove pattern ${pattern || '(empty)'}`,
    empty: 'No sensitive files. Every file can be fixed and pushed like any other.',
  },
  changeTypeTable: {
    label: 'Change-type path rules',
    pattern: 'Path pattern',
    rule: 'Rule',
    add: 'Add a path',
    remove: (pattern: string) => `Remove path ${pattern || '(empty)'}`,
    empty: 'No path rules. Every PR changes behaviour.',
    rules: {
      usesExisting: 'Uses existing parts (when only these change)',
      oneWay: 'One-way door (when any of these change)',
    },
    short: { usesExisting: 'Uses existing parts', oneWay: 'One-way door' },
  },
  errors: {
    required: 'Required.',
    positiveWhole: 'Enter a whole number above 0.',
    invalidGlob: 'Not a valid path pattern (no [ ], backslashes or .. segments).',
    reasonRequired: 'Each sensitive file pattern needs a reason.',
    invalidTaskIdPattern: 'Not a valid regular expression.',
    summary: 'Some fields need a fix before you can save. They are marked below.',
  },
} as const;
