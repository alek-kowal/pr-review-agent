// Copy for Settings → Pipeline: the read-only diagram and a stage's Sheet.
import { levelNames } from './repositories.ts';

export const pipeline = {
  title: 'Pipeline',
  affects: 'nothing: read-only. Change behaviour in Review levels, Models and Instructions.',
  loading: 'Loading the pipeline…',
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
    output: 'Output',
    outputValue: (schema: string, fields: string[]) => `${schema}: ${fields.join(', ')}`,
    timeout: 'Timeout',
    attempts: 'Attempts',
    turnsOn: 'Turns on at',
    level: (level: number) => `Level ${level} · ${levelNames[level] ?? ''}`,
  },
};
