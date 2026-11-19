import { asc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import {
  agentSessions,
  findings,
  githubActions,
  questions,
  runs,
  stageExecutions,
} from '../schema/runs.ts';

export type Run = typeof runs.$inferSelect;
export type NewRun = Omit<typeof runs.$inferInsert, 'id'>;
export type StageExecution = typeof stageExecutions.$inferSelect;
export type NewStageExecution = Omit<typeof stageExecutions.$inferInsert, 'id'>;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = Omit<typeof agentSessions.$inferInsert, 'id'>;
export type FindingRow = typeof findings.$inferSelect;
export type NewFinding = Omit<typeof findings.$inferInsert, 'id'>;
export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestion = Omit<typeof questions.$inferInsert, 'id'>;
export type GithubAction = typeof githubActions.$inferSelect;
export type NewGithubAction = Omit<typeof githubActions.$inferInsert, 'id'>;

/** Postgres refused a row because of a unique constraint (optionally a named one). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const pgError = cause as { code?: string; constraint?: string } | null;
  return pgError?.code === '23505' && (!constraint || pgError.constraint === constraint);
}

/**
 * Inserts a run. A second queued or running round or implementer run on the same PR fails with a
 * unique violation on `runs_one_active_per_pr`.
 */
export async function insertRun(db: Executor, run: NewRun): Promise<Run> {
  const [row] = await db.insert(runs).values(run).returning();
  return row!;
}

export async function insertStageExecution(
  db: Executor,
  stage: NewStageExecution,
): Promise<StageExecution> {
  const [row] = await db.insert(stageExecutions).values(stage).returning();
  return row!;
}

export async function insertAgentSession(
  db: Executor,
  session: NewAgentSession,
): Promise<AgentSession> {
  const [row] = await db.insert(agentSessions).values(session).returning();
  return row!;
}

export async function insertFindings(db: Executor, rows: NewFinding[]): Promise<FindingRow[]> {
  if (rows.length === 0) return [];
  return db.insert(findings).values(rows).returning();
}

export async function insertQuestions(db: Executor, rows: NewQuestion[]): Promise<QuestionRow[]> {
  if (rows.length === 0) return [];
  return db.insert(questions).values(rows).returning();
}

export async function insertGithubAction(
  db: Executor,
  action: NewGithubAction,
): Promise<GithubAction> {
  const [row] = await db.insert(githubActions).values(action).returning();
  return row!;
}

export type RunDetail = {
  run: Run;
  /** Every attempt of every stage, in insert order. */
  stages: StageExecution[];
  sessions: AgentSession[];
  findings: FindingRow[];
  questions: QuestionRow[];
};

/** A run with its stage attempts, agent sessions, findings and questions. */
export async function getRunDetail(db: Executor, runId: number): Promise<RunDetail | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) return null;
  const stages = await db
    .select()
    .from(stageExecutions)
    .where(eq(stageExecutions.runId, runId))
    .orderBy(asc(stageExecutions.id));
  const sessions =
    stages.length === 0
      ? []
      : await db
          .select()
          .from(agentSessions)
          .where(
            inArray(
              agentSessions.stageExecutionId,
              stages.map((stage) => stage.id),
            ),
          )
          .orderBy(asc(agentSessions.id));
  const [runFindings, runQuestions] = await Promise.all([
    db.select().from(findings).where(eq(findings.runId, runId)).orderBy(asc(findings.ordinal)),
    db.select().from(questions).where(eq(questions.runId, runId)).orderBy(asc(questions.ordinal)),
  ]);
  return { run, stages, sessions, findings: runFindings, questions: runQuestions };
}
