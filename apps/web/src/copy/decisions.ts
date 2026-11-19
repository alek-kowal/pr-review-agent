// Copy for deciding findings: the actions, the inline form, the bulk bar, badges and toasts.
import type { Decision } from '@pra/core';

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export const decisions = {
  /** The decision's button in a finding and the bulk bar; "…" because each opens a form. */
  actions: {
    implement: 'Implement…',
    reject: 'Reject…',
    defer: 'Defer to ClickUp…',
  } satisfies Record<Decision, string>,
  /** The form's submit button, with the number of findings when there are several. */
  submit: (decision: Decision, count: number) =>
    `${{ implement: 'Implement', reject: 'Reject', defer: 'Defer to ClickUp' }[decision]}${
      count > 1 ? ` ${count}` : ''
    }`,
  formTitle: (decision: Decision, count: number) =>
    `${{ implement: 'Implement', reject: 'Reject', defer: 'Defer to ClickUp' }[decision]}${
      count > 1 ? ` ${count} findings` : ''
    }`,
  /** The decision badge on a finding's line. */
  badges: {
    implement: 'Implement',
    reject: 'Rejected',
    defer: 'Deferred to ClickUp',
  } satisfies Record<Decision, string>,
  /** "Rejected by Tomek (author: Kasia)"; the author signing is "Rejected by Kasia (author)". */
  decidedBy: (decision: Decision, signer: string, author: string | null) => {
    const verb = {
      implement: 'Implement: decided by',
      reject: 'Rejected by',
      defer: 'Deferred to ClickUp by',
    }[decision];
    return `${verb} ${signer} ${author === null ? '(author)' : `(author: ${author})`}`;
  },
  reasonQuote: (reason: string) => `“${reason}”`,
  decide: 'Decide',
  change: 'Change',
  usuallyDecidedBy: (author: string) => `Usually decided by: ${author} (author)`,
  optional: 'Optional',
  reason: {
    reject: 'Reason (required)',
    rejectHint: 'Shown under the finding and in the timeline.',
    rejectPlaceholder: 'Why is this not going to be fixed?',
    defer: 'Note for the follow-up task (optional)',
    implement: 'Note (optional)',
    required: 'A reason is required to reject, so the author knows why.',
  },
  enterHint: 'Enter confirms. Shift+Enter adds a line.',
  cancel: 'Cancel',
  saving: 'Signing…',
  select: (title: string) => `Select finding: ${title}`,
  bulk: {
    label: 'Bulk actions',
    selected: (n: number) => `${n} selected`,
    clear: 'Clear',
    decide: 'Decide',
  },
  toast: {
    decided: (decision: Decision, count: number) =>
      ({
        implement: `${plural(count, 'finding')} to implement`,
        reject: `${plural(count, 'finding')} rejected`,
        defer: `${plural(count, 'finding')} deferred to ClickUp`,
      })[decision],
    signed: (name: string) => `Signed by ${name}.`,
    undo: 'Undo',
    undone: 'Decision undone',
    undoFailed: 'Could not undo',
  },
  /** `decision_conflict`: someone decided one of the findings in the meantime. */
  conflict: (names: string[]) =>
    names.length > 0
      ? `${names.join(', ')} decided this in the meantime. The findings are reloaded; check them and try again.`
      : 'Someone changed this decision in the meantime. The findings are reloaded; check them and try again.',
};
