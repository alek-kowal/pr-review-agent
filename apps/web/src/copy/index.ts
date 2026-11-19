// UI copy (English). Components read strings from here, never inline them.
export const copy = {
  app: {
    name: 'PR Review Agent',
  },
  nav: {
    label: 'Main',
    pullRequests: 'Pull requests',
    activity: 'Activity',
    insights: 'Insights',
    settings: 'Settings',
  },
  prs: {
    title: 'Pull requests',
    placeholder: 'The pull request board arrives in a later slice.',
  },
  activity: {
    title: 'Activity',
    placeholder: 'The activity feed arrives in a later slice.',
  },
  insights: {
    title: 'Insights',
    placeholder: 'Cost, quality and trust insights arrive in a later slice.',
  },
  settings: {
    title: 'Settings',
    placeholder: 'Settings arrive in a later slice.',
  },
} as const;
