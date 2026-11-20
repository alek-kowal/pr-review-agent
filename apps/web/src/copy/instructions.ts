// Copy for Settings → Instructions and the instruction editor.
import { andList, instructionGapText } from './reasons.ts';
import { levelNames } from './repositories.ts';

/** The two kinds of file, as list headings. */
const kindTitles: Record<string, string> = { instruction: 'Instructions', document: 'Documents' };

export const instructions = {
  title: 'Instructions',
  /** Any list of files shows instructions apart from documents: "Documents (14)". */
  kindTitles,
  kindCount: (kind: string, n: number) => `${kindTitles[kind] ?? kind} (${n})`,
  /** One file's kind, as a badge. */
  kindName: { instruction: 'Instruction', document: 'Document' } as Record<string, string>,
  affects:
    'the text the agents read. A draft changes nothing; an activated version applies to runs that start afterwards.',
  loading: 'Loading instructions…',
  empty: 'No instruction file yet. Import them with pnpm instructions:import.',
  gaps: {
    title: 'Missing instruction files',
    hint: 'Rounds at these levels stop before their first stage, before any agent runs. Add the files below, or import them with pnpm instructions:import.',
    repository: (slug: string) => `Repository · ${slug}`,
    /** "Level 3: Verify: …", "Levels 3, 4 and 5: Verify: … is missing". */
    line: (levels: readonly number[], stage: string, missing: readonly string[]) =>
      `${levels.length === 1 ? 'Level' : 'Levels'} ${andList(levels.map(String))}: ${instructionGapText(stage, missing)}`,
  },
  sections: {
    instruction: {
      title: kindTitles.instruction!,
      hint: 'Prompts and rules: how a stage works. Pick which ones a stage reads in Settings → Pipeline.',
    },
    document: {
      title: kindTitles.document!,
      hint: 'Reference material a stage reads: feature maps, lessons, notes about a repository.',
    },
  } as Record<string, { title: string; hint: string }>,
  sectionLabel: (section: string) => `${section} files`,
  sectionEmpty: 'No file here yet.',
  columns: { file: 'File', scope: 'Scope', readBy: 'Read by', active: 'Active', draft: 'Draft' },
  scope: {
    global: 'Global',
    repository: (slug: string) => slug,
    level: (level: number) => `Level ${level} copy · ${levelNames[level] ?? ''}`,
  },
  /** "Verify", or "Verify (repo)" for a repository's own choice. */
  readBy: (stage: string, repository: string | null) =>
    repository ? `${stage} (${repository})` : stage,
  notUsed: 'Not used by any stage',
  showUnused: (n: number) => `Not used by any stage (${n})`,
  hideUnused: 'Hide files no stage reads',
  /** One line on what a known file is for, modelled on the prototype. */
  about: {
    'review-rules.md': 'What the reviewer reports and how.',
    'verify-rules.md': 'How a finding is confirmed or refuted.',
    'implement-rules.md': 'How fixes are written.',
    'classify-rules.md': 'How the change type is chosen.',
    'analyst-rules.md': 'How lessons are proposed after a PR closes.',
    'lessons.md': 'Accepted lessons. The reviewer and the analyst read them.',
    'lessons-candidates.md': 'Lessons proposed but not accepted yet.',
    'repo-knowledge.md': 'What the reviewer should know about this repository.',
    'review-levels.json': 'Old review level table. No stage reads it.',
    'review-profiles.json': 'Old review profiles. No stage reads it.',
  } as Record<string, string>,
  aboutFeatureMap: 'A map of one part of the code, for the reviewer.',
  aboutPrompt: (role: string) => `The ${role} prompt: its task and its output.`,
  newFile: {
    open: 'New file',
    title: 'New instruction file',
    description:
      'Version 1 starts as a draft. It changes nothing until you make it active and a stage reads it.',
    key: 'File name',
    keyHint: 'For example verify-strict-rules.md or feature-map/billing.md.',
    kind: 'Kind',
    kinds: { instruction: 'Instruction (prompt or rules)', document: 'Document (reference)' },
    scope: 'Scope',
    global: 'Global',
    content: 'First version',
    note: 'Note',
    create: 'Create draft',
    creating: 'Creating…',
    cancel: 'Cancel',
    close: 'Close',
  },
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
    discardDraft: 'Discard draft',
    discarding: 'Discarding…',
    draftDiscarded: 'Draft discarded.',
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
    title: (n: number) => `Make version ${n} active?`,
    description:
      'Runs that start after this read the new version. Running rounds keep the version they started with.',
    file: 'File',
    activeVersion: 'Active version',
    lines: 'Lines',
    confirm: 'Make active',
  },
  history: {
    title: 'Version history',
    hint: 'A draft or an older version changes nothing until you make it active.',
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
    makeActive: (n: number) => `Make v${n} active…`,
  },
};
