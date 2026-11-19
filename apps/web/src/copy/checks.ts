// S-04-T6: Checks and Change type on the PR page and in Run detail.
import type { ChangeType } from '@/lib/api-types.ts';

const CHANGE_TYPES: Record<ChangeType, string> = {
  uses_existing: 'Uses existing parts',
  changes_behaviour: 'Changes behaviour',
  one_way_door: 'One-way door',
};

const INSTALL: Record<string, string> = {
  ok: 'Install passed',
  failed: 'Install failed',
  skipped: 'Install skipped',
};

export const checks = {
  changeType: (type: string): string => CHANGE_TYPES[type as ChangeType] ?? type,
  changeTypes: CHANGE_TYPES,
  /** How the type was set, from the Change type stage's reason code. */
  how: (code: string): string =>
    code === 'forced_by_person'
      ? 'forced by hand'
      : code === 'judge_raised'
        ? 'raised by the judge'
        : 'set by the rules',
  panel: {
    title: 'Change type',
    none: 'The next round with Checks sets it.',
    forcedNext: (type: string) => `Next round: ${CHANGE_TYPES[type as ChangeType] ?? type}, forced`,
    force: 'Force type',
    forceTitle: 'Force the change type',
    forceHint: 'The next round uses this type instead of the rules and the judge.',
    forceLabel: 'Change type',
    automatic: 'Automatic (rules and judge)',
    save: 'Save',
    cancel: 'Cancel',
  },
  largePr: {
    title: 'Large PR',
    text: (lines: number, threshold: number) =>
      `${lines} changed lines, over the ${threshold}-line limit. Consider splitting it into smaller PRs.`,
  },
  ci: {
    label: 'CI',
    counts: (ci: { passed: number; failed: number; pending: number }) =>
      `${ci.passed} passed · ${ci.failed} failed · ${ci.pending} pending`,
    none: 'No CI checks on this commit',
  },
  install: {
    label: 'Install',
    status: (status: string): string => INSTALL[status] ?? status,
    exit: (code: number) => `exit ${code}`,
  },
  output: {
    rules: 'Rules',
    judge: 'Judge',
    judgeSkipped: 'Judge did not run',
    lines: 'Changed lines',
    needsPerson: 'Needs a person',
  },
};
