// Copy for Insights (S-19). Numbers always carry their sample size; nothing compares periods.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const insights = {
  title: 'Insights',
  tabsLabel: 'Insights sections',
  tabs: {
    overview: 'Overview',
    cost: 'Cost',
    quality: 'Quality',
    trust: 'Trust ladder',
  },
  filters: {
    label: 'Filters',
    range: 'Time range',
    rangeOption: (days: number) => `Last ${days} days`,
    author: 'Author',
    allAuthors: 'Every author',
    repo: 'Repository',
    allRepos: 'All repositories',
  },
  later: 'This tab arrives in the next task.',
  loading: 'Loading Insights…',
  failed: 'Insights could not be loaded. Try again in a moment.',
  money: (usd: number) => `$${usd.toFixed(2)}`,
  percent: (share: number) => `${Math.round(share * 100)}%`,
  /** Milliseconds as "2 h 30 min", "45 min" or "under a minute". */
  duration: (ms: number) => {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return 'under a minute';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  },
  none: '—',
  overview: {
    empty: 'No PR finished in this range.',
    emptyHint: 'Pick a longer range, another author or another repository.',
    metricsLabel: 'Pilot metrics',
    /** "Based on 17 PRs merged", or "… merged or closed" when the sample has closed PRs. */
    basedOn: (n: number, closed: boolean) =>
      `Based on ${plural(n, 'PR')} ${closed ? 'merged or closed' : 'merged'}`,
    tooFew: 'too few for firm conclusions',
    median: 'median',
    metrics: {
      agentWork: {
        label: 'Agent work per PR',
        definition:
          'Time agents actually worked on the PR: every round, implementer run, fix check and retry. Queue time is not counted; failed stages are.',
      },
      readyToMerge: {
        label: 'Ready → merge',
        definition: 'From the first “ready for review” in GitHub to the merge, for merged PRs.',
      },
      cost: {
        label: 'Cost per PR',
        definition: (trialUsd: string, analystUsd: string) =>
          `Every agent session on the PR at API rates. Trials (${trialUsd}) and the analyst (${analystUsd}) are not included.`,
      },
      roundsUsedUp: {
        label: 'Not finished after 3 rounds',
        value: (count: number, of: number) => `${count} of ${of}`,
        definition: (over: number) =>
          `PRs where a chain used all 3 automatic rounds while a fix was still open. ${plural(over, 'PR')} had more than 3 rounds in total.`,
      },
      changedAfterReady: {
        label: 'Ready, then changed by a person',
        value: (count: number, of: number) => `${count} of ${of}`,
        definition: (ignored: number) =>
          `Merged PRs that were Ready to merge and then got a commit from a person, or were merged at another commit. A lower bound.${ignored ? ` ${plural(ignored, 'commit')} that only merged the base branch ignored.` : ''}`,
      },
    },
    lanes: {
      title: 'Where the time goes, ready → merge',
      sample: (n: number) => plural(n, 'merged PR'),
      agentsWorking: 'Agents working',
      actionNeeded: 'Action needed',
      readyToMerge: 'Ready to merge',
      queueNote: 'Agents working includes the queue.',
    },
    table: {
      title: (n: number) => `${plural(n, 'pull request')} in the range`,
      columns: {
        pullRequest: 'Pull request',
        author: 'Author',
        readyToMerge: 'Ready → merge',
        agentWork: 'Agent work',
        cost: 'Cost',
        rounds: 'Rounds',
        changedAfterReady: 'Changed after ready',
      },
      number: (n: number) => `#${n}`,
      merged: 'merged',
      closed: 'closed without merging',
      yes: 'Yes',
      no: 'No',
    },
    notMeasured: {
      title: 'Not measured yet',
      intro: 'These need about a month of data, or E2E on every PR:',
      items: [
        'Where problems are found: agent, person, CI, or after merge.',
        'Fix PRs and reverts within 14 days of merge.',
        'Regressions caught by E2E.',
      ],
    },
  },
} as const;
