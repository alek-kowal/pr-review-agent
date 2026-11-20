// Copy for Settings → Instructions and the instruction editor.
import { andList, instructionGapText } from './reasons.ts';
import { levelNames } from './repositories.ts';

export const instructions = {
  title: 'Instructions',
  affects:
    'the text the agents read. A draft changes nothing; an activated version applies to runs that start afterwards.',
  loading: 'Loading instructions…',
  empty: 'No instruction file yet. Import them with pnpm instructions:import.',
  gaps: {
    title: 'Missing instruction files',
    hint: 'Rounds at these levels stop before their first stage, before any agent runs. Add the files below, or import them with pnpm instructions:import.',
    /** "Level 3: Verify: …", "Levels 3, 4 and 5: Verify: … is missing". */
    line: (levels: readonly number[], stage: string, missing: readonly string[]) =>
      `${levels.length === 1 ? 'Level' : 'Levels'} ${andList(levels.map(String))}: ${instructionGapText(stage, missing)}`,
  },
  groups: {
    global: 'Global',
    repository: (slug: string) => `Repository · ${slug}`,
    level: (level: number) => `Level ${level} copy · ${levelNames[level] ?? ''}`,
  },
  groupLabel: (group: string) => `${group} files`,
  columns: { file: 'File', active: 'Active', draft: 'Draft', note: 'Note' },
  version: (n: number) => `v${n}`,
  none: '—',
  back: 'All instructions',
  editor: {
    title: (fileKey: string) => fileKey,
    scope: {
      global: 'Global file',
      repository: (slug: string) => `Copy for ${slug}`,
      level: (level: number) => `Copy for level ${level}`,
    },
    contentLabel: 'Text',
    noteLabel: 'Note',
    notePlaceholder: 'What changes and why',
    saveDraft: 'Save as draft',
    savingDraft: 'Saving…',
    draftSaved: 'Draft saved. It changes nothing until it is activated.',
    tryOnPr: 'Try on a PR…',
    activate: (n: number) => `Activate version ${n}…`,
    editingDraft: (n: number) => `Editing draft version ${n}`,
    editingNew: (n: number) => `A save starts draft version ${n}`,
    noActive: 'No active version yet.',
    diffLabel: (n: number | null) =>
      n === null ? 'Changes' : `Changes against the active version ${n}`,
    noChanges: 'No changes against the active version.',
    diffSummary: (added: number, removed: number) => `+${added} −${removed}`,
    added: 'Added',
    removed: 'Removed',
  },
  activateDialog: {
    title: (n: number) => `Activate version ${n}?`,
    rollbackTitle: (n: number) => `Roll back to version ${n}?`,
    description:
      'Runs that start after this read the new version. Running rounds keep the version they started with.',
    file: 'File',
    activeVersion: 'Active version',
    lines: 'Lines',
    confirm: 'Activate',
    rollbackConfirm: 'Roll back',
  },
  history: {
    title: 'Version history',
    tableLabel: 'Versions',
    columns: {
      version: 'Version',
      status: 'Status',
      note: 'Note',
      by: 'By',
      runs: 'Runs that used it',
      actions: 'Actions',
    },
    status: { active: 'Active', draft: 'Draft', archived: 'Archived' } as Record<string, string>,
    by: {
      bot: 'Imported',
      hand: 'By hand',
      signed: (name: string) => `Signed by ${name}`,
    },
    noRuns: 'No run yet',
    run: (repo: string, pr: number, runId: number) => `${repo} #${pr} · run ${runId}`,
    moreRuns: (n: number) => `and ${n} more`,
    rollback: (n: number) => `Roll back to v${n}…`,
  },
};
