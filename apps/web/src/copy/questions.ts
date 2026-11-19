// Copy for the Questions tab: the reviewer's questions and the team's signed answers (S-08).
import { plural } from './format.ts';

export const questions = {
  label: (ordinal: number) => `Q${ordinal}`,
  options: 'Options',
  recommended: 'Recommended',
  ownAnswer: 'Own answer',
  ownAnswerPlaceholder: 'Or write your own answer',
  /** "Kasia answered" above the answer. */
  answeredBy: (name: string) => `${name} answered`,
  ownAnswerTag: 'own answer',
  save: (count: number) => (count > 0 ? `Save ${plural(count, 'answer')}` : 'Save answers'),
  saving: 'Saving…',
  /** Why Save is disabled. */
  answerEvery: 'Answer every question and pick your name to save.',
  saved: (count: number) => `${plural(count, 'answer')} saved`,
  signed: (name: string) => `Signed by ${name}.`,
  /** 409: someone answered first. */
  conflict: (names: string[]) =>
    `${names.join(' and ') || 'Someone'} answered in the meantime. Their answer is shown now; check it, then save again.`,
  readOnly: 'This pull request is closed, so its questions can no longer be answered.',
};
