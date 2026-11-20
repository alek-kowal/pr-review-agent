// Copy for Settings → Pipeline: the read-only diagram and a stage's Sheet, where a stage's
// instruction files are picked per scope (STAGEFILES).
import { andList } from './reasons.ts';
import { levelNames } from './repositories.ts';

export const pipeline = {
  title: 'Pipeline',
  affects:
    'the instruction files each stage reads, for runs that start after you save. The diagram is read-only; change models and levels in Models and Review levels.',
  loading: 'Loading the pipeline…',
  scope: {
    label: 'Stage files for',
    global: 'Global (every repository)',
    hint: 'A repository reads the Global files unless you pick other files for it.',
  },
  diagramLabel: 'Pipeline diagram',
  hint: 'Pick a stage for its details.',
  tableLabel: 'Stages',
  columns: {
    stage: 'Stage',
    runsAs: 'Runs as',
    model: 'Model',
    from: 'From level',
    timeout: 'Timeout',
    attempts: 'Attempts',
  },
  stages: {
    checks: 'Checks',
    task: 'Task',
    change_type: 'Change type',
    review: 'Review',
    verify: 'Verify',
    implement: 'Implement',
    fix_check: 'Fix check',
    analyst: 'Analyst',
  } as Record<string, string>,
  what: {
    checks:
      'Fetches the branch, reads CI results, runs the install command and lists the sensitive files the PR changes.',
    task: 'Finds the ClickUp task for the PR from the branch name, the PR text or a linked task.',
    change_type:
      'Rules on paths and size set the floor. The judge may only raise it: uses existing parts, changes behaviour or one-way door.',
    review:
      'Reads the diff, the task and the code around the change. Writes findings and questions within the limits of the level.',
    verify:
      'Checks each finding without seeing the proposed fix. Quotes must exist word for word; a reproduction script runs in a sandbox.',
    implement:
      'Fixes the findings marked Implement in a separate copy of the branch. Edit only, no shell.',
    fix_check:
      'Starts only when the head is the factory’s own commit. Checks whether each finding marked Implement is fixed.',
    analyst:
      'After a PR closes, reads the case and proposes lessons. A person accepts every lesson.',
  } as Record<string, string>,
  node: (stage: string, level: number) => `${stage}, from level ${level}`,
  nodeLevel: (level: number) => `L${level}`,
  runsAs: { agent: 'agent', code: 'code' },
  role: (role: string) => `role: ${role}`,
  noModel: 'No model: plain code',
  modelSource: {
    level: (level: number | null) =>
      level === null ? 'set by the level' : `set at level ${level}`,
    settings: 'set in Models',
    default: 'default',
  },
  timeout: (minutes: number) => `${minutes} min`,
  attempts: (attempts: number, repairs: number) =>
    repairs === 0
      ? `${attempts} (a retry is a button, not automatic)`
      : `${attempts} + ${repairs} repair of the script`,
  sheet: {
    subtitle: (runsAs: string, level: number) => `${runsAs} stage · runs from level ${level}`,
    close: 'Close',
    model: 'Model',
    tools: 'Tools',
    noTools: 'None',
    integrations: 'Calls',
    instructions: 'Instructions',
    noInstructions: 'None: the prompt is built in.',
    fileVersion: (fileKey: string, version: number | null) =>
      version === null ? `${fileKey} (no active version)` : `${fileKey} v${version}`,
    version: (version: number | null) => (version === null ? '(no active version)' : `v${version}`),
    output: 'Output',
    outputValue: (schema: string, fields: string[]) => `${schema}: ${fields.join(', ')}`,
    timeout: 'Timeout',
    attempts: 'Attempts',
    turnsOn: 'Turns on at',
    level: (level: number) => `Level ${level} · ${levelNames[level] ?? ''}`,
  },
  files: {
    title: 'Instruction files',
    scopeGlobal: 'Global: every repository that does not pick its own files.',
    scopeRepository: (slug: string) => `For ${slug} only.`,
    slots: { prompt: 'Prompt', rules: 'Rules', documents: 'Documents' } as Record<string, string>,
    pick: (stage: string, slot: string) => `${stage} ${slot.toLowerCase()} file`,
    builtIn: 'Built in',
    source: {
      default: 'Default',
      changed: 'Changed from default',
      inherited: 'Inherited from global',
      overridden: 'Overridden for this repository',
      resetGlobal: 'Goes back to the default when you save',
      resetRepository: 'Goes back to the global files when you save',
    },
    reset: (slot: string) => `Reset ${slot.toLowerCase()}`,
    resetLabel: 'Reset',
    noDocuments: 'No documents at this scope.',
    onlyIn: (slugs: readonly string[]) => `Only in ${andList([...slugs])}: pick it above`,
    save: 'Save…',
    saved: 'Saved. Runs that start now read these files.',
    dialogTitle: (stage: string) => `Save the instruction files of ${stage}?`,
    dialogDescription: (scope: string) =>
      `${scope} Runs that start after this read the new files; running rounds keep theirs.`,
    inheritsGlobal: 'Global files',
    inheritsDefault: 'Default files',
    none: 'None',
  },
};
