// Rows for the board and decision tests: a PR in one repository, with rounds and findings.
import {
  insertFindings,
  insertQuestions,
  insertRun,
  insertStageExecution,
  upsertPullRequest,
  type Db,
  type FindingRow,
  type NewFinding,
  type NewRun,
  type PullRequest,
  type PullRequestSnapshot,
  type QuestionRow,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aQuestion, aRun } from '@pra/db/testing';

export type SeededRound = { run: Run; findings: FindingRow[]; questions: QuestionRow[] };

/** A PR in the repository; `updatedAt` defaults to now, so a merged one is recent. */
export async function seedPr(
  db: Db,
  repositoryId: number,
  patch: Partial<PullRequestSnapshot> = {},
): Promise<PullRequest> {
  const { pullRequest } = await upsertPullRequest(
    db,
    aPullRequest(repositoryId, { updatedAt: new Date(), ...patch }),
  );
  return pullRequest;
}

/** A round on the PR with findings (Worth fixing unless patched) and questions. */
export async function seedRound(
  db: Db,
  pullRequest: PullRequest,
  options: {
    run?: Partial<NewRun>;
    findings?: Partial<NewFinding>[];
    questions?: number;
    failedAt?: { stage: string; errorCode: string };
  } = {},
): Promise<SeededRound> {
  const run = await insertRun(
    db,
    aRun(pullRequest.id, {
      status: 'completed',
      headSha: pullRequest.headSha,
      commitsCountAtStart: pullRequest.commitsCount,
      ...options.run,
    }),
  );
  if (options.failedAt) {
    await insertStageExecution(db, {
      runId: run.id,
      stage: options.failedAt.stage,
      status: 'failed',
      errorCode: options.failedAt.errorCode,
    });
  }
  const findings = options.findings?.length
    ? await insertFindings(
        db,
        options.findings.map((patch, i) => aFinding(run.id, pullRequest.id, i + 1, patch)),
      )
    : [];
  const questions = options.questions
    ? await insertQuestions(
        db,
        Array.from({ length: options.questions }, (_, i) => aQuestion(run.id, i + 1)),
      )
    : [];
  return { run, findings, questions };
}

/** Blocking findings, `count` of them. */
export const blocking = (count: number): Partial<NewFinding>[] =>
  Array.from({ length: count }, () => ({ severity: 'blocking' as const }));
