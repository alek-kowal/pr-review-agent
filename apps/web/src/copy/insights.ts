// Copy for Insights (S-19). Numbers always carry their sample size; nothing compares periods.

import { autofix } from './autofix.ts';
import { amount, money } from './format.ts';
import { levelNames } from './repositories.ts';

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
  loading: 'Loading Insights…',
  failed: 'Insights could not be loaded. Try again in a moment.',
  money: (usd: number) => money(usd),
  /** A chart tick: the axis title carries the label. */
  tick: (usd: number) => amount(usd),
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
  level: (n: number) => `${n} · ${levelNames[n] ?? ''}`,
  /** Shown instead of rates below 5 findings. */
  tooFewFindings: (n: number) => `Too few findings (${n} of 5)`,
  tooFewHint: 'Rates show from 5 findings up. Fewer would be noise.',
  unchecked: 'Unchecked',
  uncheckedHint: 'Levels 1–2 do not verify findings.',
  cost: {
    statsLabel: 'Spend',
    today: 'Spent today',
    ofBudget: (budget: string) => `of ${budget} daily budget`,
    noBudget: 'No daily budget set',
    rangeTotal: (days: number) => `Last ${days} days`,
    rangeTotalSub: (repo: string | undefined) =>
      repo ? `PR work in ${repo}` : 'PR work, all repositories',
    averageRound: 'Average round',
    averageRoundSub: 'completed rounds in the range',
    byDay: 'Spend by day',
    byDayChart: (days: number) => `Daily spend for the last ${days} days`,
    day: 'Day',
    spent: 'Spent',
    byRepository: 'By repository',
    byRole: 'By agent role',
    byLevel: 'By review level',
    nothing: 'Nothing spent in this range.',
    roles: {
      reviewer: 'Reviewer',
      verifier: 'Verifier',
      implementer: 'Implementer',
      judge: 'Judge',
      analyst: 'Analyst',
    } as Record<string, string>,
    separate: 'Not in PR cost',
    separateHint: 'Trials and the analyst after close are kept out of every figure above.',
    trials: 'Trials',
    analyst: 'Analyst',
  },
  quality: {
    perLevel: 'Per review level',
    perLevelHint:
      'Confirmed and Refuted come from the verifier (level 3 and up). Decided Implement is the share of decided findings that people chose to fix.',
    perVersion: 'Per file version',
    /** A table's name: "Instructions, per version". */
    perVersionOf: (kindTitle: string) => `${kindTitle}, per version`,
    columns: {
      level: 'Level',
      rounds: 'Rounds',
      runs: 'Runs',
      findings: 'Findings',
      confirmed: 'Confirmed',
      refuted: 'Refuted',
      implement: 'Decided Implement',
      averageRound: 'Average round',
      averageCost: 'Average cost',
      version: 'Version',
    },
    version: (n: number, active: boolean) => `v${n}${active ? ' · active' : ''}`,
    noVersion: 'No version recorded',
    noRuns: 'No run in this range.',
  },
  trust: {
    ladderLabel: 'Review levels',
    changeLevel: 'Change the level',
    cardHint:
      'A repository earns a higher review level when people keep agreeing with what the current level finds.',
    empty: 'No repository is connected yet.',
    /** "Level 3 for 14 days:" */
    heading: (level: number, days: number) => `Level ${level} for ${plural(days, 'day')}:`,
    rates: (implement: string, confirmed: string, refuted: string) =>
      `${implement} of decided findings were Implement, ${confirmed} confirmed, ${refuted} refuted.`,
    ratesUnchecked: (implement: string) =>
      `${implement} of decided findings were Implement. Findings are not verified at this level.`,
    noDecided: 'No finding has been decided yet.',
    tooFew: (n: number) => `Too few findings for rates yet (${n} of 5).`,
    basedOn: (findings: number, rounds: number) =>
      `Based on ${plural(findings, 'finding')} in ${plural(rounds, 'round')}.`,
    shadow: {
      title: 'Level 5 shadow log',
      /** "Level 5 would have fixed 3 of 8 PRs" */
      summary: (wouldFix: number, prs: number) =>
        `Level 5 would have fixed ${wouldFix} of ${plural(prs, 'PR')}`,
      lastDays: (days: number) => `last ${plural(days, 'day')}`,
      nothingPushed: 'Nothing was pushed: this is only a log of what autofix would have done.',
      notEnough: (prs: number, needed: number) => `Not enough data yet (${prs} of ${needed} PRs)`,
      startsAtLevel3: 'The shadow log needs verified findings, so it starts at level 3.',
      listLabel: 'PRs in the shadow log',
      /** One PR's row after its number: "would have waited: 2 questions to answer". */
      row: autofix.shadow,
    },
  },
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
