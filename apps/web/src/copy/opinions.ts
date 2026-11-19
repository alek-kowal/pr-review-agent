// Copy for opinions on findings and the signed review that saves them (S-08-T6).
import { plural, reviewCounts } from './format.ts';

export type OpinionValueKey = 'worth' | 'not_worth';

export const opinions = {
  values: {
    worth: 'Worth implementing',
    not_worth: 'Not worth it',
  } satisfies Record<OpinionValueKey, string>,
  heading: (count: number) =>
    count > 0 ? `Opinions from the team (${count})` : 'Opinions from the team',
  none: 'No opinions yet.',
  label: 'Opinion',
  yourDraft: 'your draft',
  /** The counts on a finding's line, read out and shown as a tooltip. */
  counts: (worth: string[], notWorth: string[]) =>
    [
      worth.length > 0 && `Worth implementing: ${worth.join(', ')}`,
      notWorth.length > 0 && `Not worth it: ${notWorth.join(', ')}`,
    ]
      .filter(Boolean)
      .join(' · '),
  commentLabel: 'Comment for your opinion (optional)',
  commentPlaceholder: 'Comment on your opinion (optional)',
  comment: (text: string) => `“${text}”`,
  fromRound: (round: number) => `from round ${round}`,
  carriedHint: 'Carried over from an earlier round: same file and content.',
  tray: {
    label: 'Your review',
    title: (count: number) => `Your review: ${plural(count, 'opinion')}`,
    counts: reviewCounts,
    discard: 'Discard',
    save: 'Save review…',
  },
  dialog: {
    title: 'Save your review',
    description: (author: string) => `One signed review. ${author} sees it before deciding.`,
    keepEditing: 'Keep editing',
    submit: 'Save review',
    saving: 'Signing…',
  },
  toast: {
    saved: (signer: string) => `${signer}'s review saved`,
    savedHint: (count: number, number: string, author: string) =>
      `${plural(count, 'opinion')} on #${number}. ${author} is not notified yet.`,
  },
};
