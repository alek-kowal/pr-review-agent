// Reviewer context provider (S-08-T3, FR-035): every earlier answer on the PR goes to the reviewer
// of every later round, in a new chain too. Fix checks get the same answers (`fix-check.ts`).
import { TEAM_ANSWERS_TITLE, teamAnswersBody, type TeamAnswer } from '@pra/agents';
import { answersOfPullRequest, type Executor, type Run } from '@pra/db';
import type { ReviewerContextProvider } from './context.ts';

/** The PR's answers to questions of runs before `run`, oldest first. */
export async function earlierAnswers(db: Executor, run: Run): Promise<TeamAnswer[]> {
  const answers = await answersOfPullRequest(db, run.pullRequestId);
  return answers
    .filter((a) => a.runId < run.id)
    .map((a) => ({ question: a.question, answer: a.answer, by: a.signerName }));
}

export const answersProvider: ReviewerContextProvider = {
  key: 'answers',
  async sections({ deps, run }) {
    const answers = await earlierAnswers(deps.db, run);
    if (answers.length === 0) return [];
    return [{ title: TEAM_ANSWERS_TITLE, body: teamAnswersBody(answers) }];
  },
};
