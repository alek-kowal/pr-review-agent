// Copy for Settings → Review levels (S-21-T5).
import { levelNames } from './repositories.ts';

const name = (n: number) => levelNames[n] ?? '';

export const levels = {
  title: 'Review levels',
  affects:
    'what runs in a round. A higher level includes everything below it and costs more per round.',
  loading: 'Loading review levels…',
  ladder: {
    title: 'The ladder',
    sub: 'Each level adds something to the one below. Open a level to change its settings.',
    label: 'Review levels 1 to 6',
  },
  /** What each level adds, in a sentence (PRD level ladder). */
  description: {
    1: 'Review. Findings are not verified.',
    2: 'Checks (CI and install), Task, Change type.',
    3: 'Verify: each finding gets a verdict with quoted evidence and a reproduction.',
    4: 'Implement with agent. Nothing is pushed without a person.',
    5: 'Fixes and pushes by itself when every autofix condition holds.',
    6: 'After a PR closes, the analyst proposes lessons for a person to accept.',
  } as Record<number, string>,
  /** Core `levelAdds` keys: stages and level features. */
  adds: {
    review: 'Review',
    checks: 'Checks',
    task: 'Task',
    change_type: 'Change type',
    verify: 'Verify',
    implement: 'Implement with agent',
    autofix: 'Autofix',
    learning: 'Learning',
  } as Record<string, string>,
  defaultBadge: 'Default',
  defaultLevel: {
    title: 'Default level',
    label: 'Default for repositories without their own',
    hint: 'Each repository can set its own default in Repositories.',
    field: 'Default level',
    saveTitle: 'Change the default level',
    saveDescription: (n: number) =>
      `Round 1 of new PRs uses level ${n} in repositories without their own default.`,
  },
  levelOption: (n: number) => `${n} · ${name(n)}`,
  page: {
    title: (n: number) => `Level ${n} · ${name(n)}`,
    affects: (n: number) =>
      n < 6
        ? `every new round at level ${n}, and the higher levels that inherit from it.`
        : `every new round at level ${n}.`,
    breadcrumb: 'Breadcrumb',
    back: 'Review levels',
    level: (n: number) => `Level ${n}`,
    unknown: 'There is no such level. Levels go from 1 to 6.',
    adds: 'What this level adds',
    addsNothing: 'Nothing new: the same stages as the level below.',
    saveTitle: (n: number) => `Save level ${n}`,
    saveDescription: (n: number) =>
      n < 6
        ? `New rounds at level ${n}, and at higher levels that inherit these values, use the new settings. Running rounds keep theirs.`
        : `New rounds at level ${n} use the new settings. Running rounds keep theirs.`,
    invalidSummary: 'Fix the values marked below before saving.',
  },
  settings: {
    title: 'Settings',
    sub: 'A value is inherited from the nearest lower level that sets it, until you give this level its own.',
  },
  fields: {
    brief: {
      label: 'Reviewer brief',
      hint: "One paragraph added to the reviewer's instructions at this level.",
    },
    maxFindings: {
      label: 'Most findings per round',
      hint: "The reviewer's list is cut to this number (at most 7).",
    },
    maxQuestions: { label: 'Most questions per round', hint: '0 means the reviewer may not ask.' },
    stageTimeoutMinutes: {
      label: 'Review timeout',
      hint: 'Minutes before a stage of the round is stopped.',
    },
    autofixMaxPatches: {
      label: 'Automatic patches per chain',
      hint: 'How many patches level 5 may push by itself in one chain of rounds.',
    },
  } as Record<string, { label: string; hint: string }>,
  minutes: (n: number) => `${n} min`,
  minUnit: 'min',
  noBrief: 'No brief',
  inherited: 'Inherited',
  own: 'Own value',
  sourceLabel: (field: string) => `${field}: inherited or own value`,
  /** Where an inherited value comes from. */
  from: (level: number, builtIn: boolean) =>
    builtIn ? `built in at level ${level}` : `from level ${level}`,
  fromModels: 'from Models',
  ownValue: 'own value',
  invalid: {
    maxFindings: 'Enter a whole number from 0 to 7.',
    maxQuestions: 'Enter a whole number from 0 to 10.',
    stageTimeoutMinutes: 'Enter a whole number of minutes from 1 to 240.',
    autofixMaxPatches: 'Enter a whole number from 0 to 10.',
    model:
      'Not a valid model name. Start with a letter or digit, then use letters, digits and . _ : @ [ ] - only (no spaces).',
  } as Record<string, string>,
  models: {
    title: 'Models at this level',
    open: 'Open Models',
    field: (role: string) => `${role} model`,
  },
  autofix: {
    title: 'Autofix conditions',
    sub: 'At level 5 the bot starts the implementer and pushes by itself only when all of these hold. Otherwise it waits and says why on the PR. At lower levels the same check runs silently and is logged.',
    rules: [
      'Every finding that needs work is confirmed and fixed by the patch.',
      'Every reproduction passes on the patched code.',
      'The patch touches no sensitive file.',
    ],
    atMostBefore: 'At most',
    atMostAfter: 'automatic patches per chain.',
    only: 'Only the number of patches can be changed.',
  },
};
