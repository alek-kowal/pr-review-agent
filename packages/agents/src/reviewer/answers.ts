// S-08-T3 (FR-035): the team's answers to the reviewer's earlier questions, as every later round
// of the PR reads them: a full review in its brief, a fix check in answers.md.

/** One answered question: the question, the chosen option or own text, and who answered. */
export type TeamAnswer = { question: string; answer: string; by: string };

export const TEAM_ANSWERS_TITLE = 'Answers from the team';

/** The answers as a Markdown list, oldest first. */
export function teamAnswersBody(answers: readonly TeamAnswer[]): string {
  return [
    'The team answered these questions from earlier rounds of this pull request. Take the',
    'answers as given: do not ask them again, and review with them in mind.',
    '',
    ...answers.flatMap((a) => [`- Q: ${a.question}`, `  A (${a.by}): ${a.answer}`]),
  ].join('\n');
}
