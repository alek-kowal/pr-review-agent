// Copy for the Activity page: what agents are doing now.

export const activity = {
  title: 'Activity',
  loading: 'Loading what agents are doing…',
  inProgress: {
    title: 'In progress',
    empty: 'No agent is working and nothing is queued.',
    columns: {
      pullRequest: 'Pull request',
      run: 'Run',
      stage: 'Current stage',
      started: 'Started',
      cost: 'Cost so far',
      actions: 'Actions',
    },
    queued: 'Queued',
    /** Between two stages, before the next one has started. */
    starting: 'Starting',
    notStarted: 'Not started',
  },
};
