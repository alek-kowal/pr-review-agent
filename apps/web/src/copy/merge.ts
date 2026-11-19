// Copy for Merge from the app (S-12-T4): the banner action, the Merge dialog and its answers.
import { shortSha } from './nextStep.ts';

export const merge = {
  open: (number: number) => `Merge #${number}…`,
  title: (number: number) => `Merge #${number}`,
  description: (sha: string, base: string) =>
    `Squash merge at ${shortSha(sha)} into ${base}. Cannot be undone from here.`,
  checklistGreen: (total: number) => `Merge checklist: ${total} of ${total} pass`,
  checklistFailing: 'The merge checklist is not green:',
  freshCheck: 'Checked again against fresh GitHub state when you click Merge.',
  typeNumber: (number: number) => `Type ${number} to confirm`,
  signatureHint: 'Recorded as “Merged by …” in the timeline.',
  cancel: 'Cancel',
  confirm: (number: number) => `Merge #${number}`,
  merging: 'Merging…',
  /** Why Merge is disabled. */
  typeToConfirm: (number: number) => `Type the PR number ${number} to confirm.`,
  pickSigner: 'Pick your name to sign the merge.',
  merged: (number: number, by: string) => `#${number} merged by ${by}`,
  mergedHint: (sha: string) => `Squash-merged at ${shortSha(sha)}. The PR left the board.`,
  /** 409 `merge_not_ready`: the failing rows follow. */
  notReady: 'The merge checklist is not green on fresh GitHub state:',
  refused: (message: string) => `GitHub refused the merge: ${message}`,
  headMoved: (headSha: string) =>
    `New commits arrived after the review: the head is now ${shortSha(headSha)}. Review them first.`,
};
