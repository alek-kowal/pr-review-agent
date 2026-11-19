// Copy for Push (S-14-T4): the Patch ready banner's action, the Push dialog and its answers. The
// patch summary line reuses the Patch tab's (`implementer.patch.summary`, `.files`).
import { shortSha } from './nextStep.ts';

export const push = {
  open: (branch: string) => `Push to ${branch}…`,
  title: (branch: string) => `Push to ${branch}`,
  description: (sha: string) =>
    `One commit by pr-review-agent on top of ${shortSha(sha)}. Never forced. The fix check starts by itself.`,
  freshCheck: 'Checked again against fresh GitHub state when you click Push.',
  typeNumber: (number: number) => `Type ${number} to confirm`,
  signatureHint: 'Recorded as “Pushed by …” and as Co-authored-by on the commit.',
  cancel: 'Cancel',
  confirm: (branch: string) => `Push to ${branch}`,
  pushing: 'Pushing…',
  /** Why Push is disabled. */
  typeToConfirm: (number: number) => `Type the PR number ${number} to confirm.`,
  pickSigner: 'Pick your name to sign the push.',
  queued: (branch: string) => `Pushing to ${branch}`,
  queuedHint: 'The fix check starts when GitHub reports the new commit.',
  /** 409 refusals, in plain words. */
  headMoved: (headSha: string) =>
    `The head moved to ${shortSha(headSha)} after the patch was made. Start review to check the new commits.`,
  numberMismatch: (number: number) => `The typed number is not this PR’s number (${number}).`,
};
