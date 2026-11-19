// Copy for "Try on a PR…", Settings → Experiments and a trial's Compare page.
import { money } from './format.ts';

export const trials = {
  tryDialog: {
    open: 'Try on a PR…',
    title: (fileKey: string, version: number) => `Try ${fileKey} v${version} on a PR`,
    description:
      'Two runs review the PR’s current commit: A with the active instructions, B with this draft. The PR, its board lane and GitHub are not touched.',
    prLabel: 'Pull request',
    pickPr: 'Pick a pull request',
    search: 'Search pull requests',
    noMatch: 'No pull request matches.',
    none: 'No open pull request to try it on.',
    pr: (repo: string, number: number, title: string) => `${repo} #${number} ${title}`,
    start: 'Start the trial',
    starting: 'Starting…',
    cancel: 'Cancel',
    prRequired: 'Pick a pull request first.',
  },
  experiments: {
    title: 'Experiments',
    affects: 'nothing: trials only compare a draft with the active instructions on one PR.',
    loading: 'Loading trials…',
    empty: 'No trial yet. Open an instruction file, save a draft and pick “Try on a PR…”.',
    tableLabel: 'Trials',
    columns: {
      trial: 'Trial',
      pr: 'Pull request',
      draft: 'Draft',
      status: 'Status',
      started: 'Started',
    },
    trial: (id: number) => `Trial ${id}`,
    pr: (repo: string, number: number) => `${repo} #${number}`,
    draft: (fileKey: string, version: number) => `${fileKey} v${version}`,
    startedByHand: 'Started by hand',
  },
  // A trial's status, and each run's on the Compare page.
  status: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Finished',
    failed: 'Failed',
    cancelled: 'Cancelled',
  } as Record<string, string>,
  compare: {
    title: (id: number) => `Trial ${id}`,
    back: 'All experiments',
    loading: 'Loading the trial…',
    subtitle: (repo: string, number: number, title: string, sha: string) =>
      `${repo} #${number} ${title} · commit ${sha.slice(0, 7)}`,
    running: 'Both runs are still working. The compare fills in when they finish.',
    sides: { a: 'A · active instructions', b: 'B · draft' },
    cost: 'Cost',
    costLabel: (side: string) => `Cost of ${side}`,
    money,
    runLink: 'Run details',
    buckets: {
      onlyA: 'Only in A',
      onlyB: 'Only in B',
      both: 'In both',
    },
    none: 'None',
    finding: (file: string, line: number | null) => (line === null ? file : `${file}:${line}`),
    diffLabel: (fileKey: string, before: number | null, after: number) =>
      before === null ? `${fileKey}: draft v${after}` : `${fileKey}: v${before} → draft v${after}`,
    activate: (version: number) => `Go to activate version ${version}`,
    noLongerDraft: (version: number, status: string) =>
      `Version ${version} is no longer a draft (${status}).`,
  },
};
