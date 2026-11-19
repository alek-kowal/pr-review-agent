// Copy for Implement with agent (S-13-T5) and the Patch tab (S-13-T6).
import type { PatchReproduction, ReasonView } from '@/lib/api-types.ts';

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const reproductionWords: Record<PatchReproduction, string> = {
  pass: 'pass',
  fail: 'fail',
  not_run: 'not run',
};

/** Why Implement with agent is off, from the PR view's `implementer.block` or `gate.reason`. */
function blockText(reason: ReasonView): string {
  switch (reason.code) {
    case 'fork_read_only':
      return 'Fork PRs stay read-only: no implementer and no push.';
    case 'implement_below_level':
      return `Implement with agent needs level ${n(reason.params.need)}. This PR is at level ${n(reason.params.level)}.`;
    case 'no_implement_decisions':
      return 'No open finding is decided Implement.';
    case 'run_active':
      return 'A round or the implementer is already running on this PR.';
    default:
      return `Implement with agent is off (${reason.code}).`;
  }
}

export const implementer = {
  blockText,
  /** The checkbox in the Implement form and in the bulk bar. */
  withAgent: 'Implement with agent',
  withAgentHint: 'The agent writes a patch. You review it before anything is pushed.',
  /** The banner's Dialog on Waiting for the fix. */
  dialog: {
    title: 'Implement with agent',
    description: (count: number) =>
      `The agent fixes ${plural(count, 'finding')} decided Implement and writes a patch. Nothing is pushed until you review it.`,
    findings: 'Findings',
    finding: (ordinal: number, title: string) => `#${ordinal} ${title}`,
    submit: 'Implement with agent',
    starting: 'Starting…',
    cancel: 'Cancel',
  },
  raiseLevel: (level: number) => `Raise this PR to level ${level}`,
  raised: (level: number) => `This PR is now at level ${level}.`,
  started: (count: number) => `Implementer started on ${plural(count, 'finding')}.`,
  startedWithDecision: 'The implementer started.',
  /** The Patch tab. */
  patch: {
    tab: 'Patch',
    empty: 'No patch yet. Implement with agent writes one.',
    running: 'The implementer is writing the patch.',
    summary: (fixed: number, total: number, reproductions: PatchReproduction) =>
      `${fixed} of ${total} fixed · reproductions ${reproductionWords[reproductions]}`,
    checking: 'Rerunning the reproductions…',
    revision: (revision: number) => `Revision ${revision}`,
    superseded: 'A newer revision replaced this patch.',
    files: (count: number) => plural(count, 'file'),
    fileStatus: {
      changed: 'changed',
      edited: 'edited by hand',
      reverted: 'reverted',
    } as Record<string, string>,
    newFile: 'new file',
    deletedFile: 'deleted',
    noChanges: 'No changes left in this file.',
    edit: 'Edit',
    editLabel: (path: string) => `Content of ${path}`,
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    revert: 'Revert file',
    /** The button's accessible name starts with its visible text (WCAG 2.5.3). */
    revertLabel: (path: string) => `Revert file ${path}`,
    reverted: (path: string) => `${path} is back to the reviewed version.`,
    saved: (path: string) => `${path} saved. The reproductions run again.`,
    revise: {
      label: 'Revise with this note',
      noteLabel: 'Note for the implementer',
      placeholder: 'What should the next revision change?',
      submit: 'Revise with this note',
      sending: 'Sending…',
      started: 'The implementer is writing a new revision.',
    },
    viewNewResults: 'View new results',
    newResults: 'New patch results are ready.',
  },
};
