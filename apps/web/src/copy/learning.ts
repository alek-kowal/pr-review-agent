// Settings → Learning (S-23-T5) and the learning status on closed PRs (S-23-T6).
const more = (missing: number) => (missing === 1 ? 'one more' : `${missing} more`);

export const learning = {
  affects:
    'The lessons file of each repository. Reviewers read accepted lessons from their next round.',
  loading: 'Loading lesson candidates…',
  loadFailed: 'Could not load the lesson candidates.',
  candidates: 'Candidates',
  candidatesHint:
    'The analyst proposes at most 5 per closed level 6 PR. A lesson needs 2 PRs before it can be accepted.',
  noCandidates: 'No candidates yet. The analyst proposes some when a level 6 PR closes.',
  accepted: 'Accepted lessons',
  noAccepted: 'No accepted lessons yet.',
  rejected: 'Rejected',
  prCount: (n: number) => (n === 1 ? '1 PR' : `${n} PRs`),
  /** Why Accept is disabled below the PR minimum. */
  needsMorePrs: (have: number, need: number) =>
    `${have} of ${need} PRs: waits for ${more(need - have)}`,
  sources: 'Seen on',
  source: (repo: string, number: number) => `${repo}#${number}`,
  editedByHand: 'Edited by hand',
  version: (version: number) => `lessons.md v${version}`,
  acceptedBy: (name: string | null) => (name ? `Accepted by ${name}` : 'Accepted'),
  rejectedBy: (name: string | null, reason: string | null) =>
    `${name ? `Rejected by ${name}` : 'Rejected'}${reason ? `: ${reason}` : ''}`,
  edit: {
    open: 'Edit',
    title: 'Title',
    text: 'Lesson',
    save: 'Save',
    cancel: 'Cancel',
    hint: 'Saved by hand, unsigned.',
    required: 'Write a title and a lesson.',
  },
  tryOnPr: 'Try on a PR…',
  reject: {
    open: 'Reject…',
    title: (title: string) => `Reject “${title}”?`,
    description:
      'The candidate leaves the list. The rejection is signed and recorded in the Audit log.',
    reason: 'Reason',
    reasonPlaceholder: 'Why this is not a lesson for this repository',
    reasonRequired: 'Write a reason.',
    submit: 'Reject',
    cancel: 'Cancel',
  },
  accept: {
    open: 'Accept…',
    title: (title: string) => `Accept “${title}”?`,
    description: (repo: string) =>
      `The lesson goes into ${repo}’s lessons.md as a new active version. Reviewers read it from their next round.`,
    submit: 'Accept',
    cancel: 'Cancel',
  },
};
