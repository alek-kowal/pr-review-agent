// Copy for the Notify author card under the banner (S-08-T11).
import { reviewCounts } from './format.ts';

export const notify = {
  label: 'Notify the author',
  title: (signer: string, worth: number, notWorth: number) =>
    `${signer}'s review saved: ${reviewCounts(worth, notWorth)}`,
  previewSource: (taskId: string) => `ClickUp ${taskId}`,
  loading: 'Loading the ClickUp comment…',
  noTask: (author: string) => `No ClickUp task linked, so there is nowhere to notify ${author}.`,
  notNow: 'Not now',
  notify: 'Notify author',
  notifying: 'Posting…',
  linkTask: 'Link a ClickUp task',
  toast: {
    notified: (author: string) => `${author} notified in ClickUp`,
    notifiedHint: (taskId: string) => `Comment posted on ${taskId}.`,
  },
};
