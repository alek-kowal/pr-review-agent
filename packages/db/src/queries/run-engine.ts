// Reads and writes the worker's run engine needs (S-01-T6, T10, T11).
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import {
  ACTIVE_RUN_STATUSES,
  agentSessions,
  BLOCKING_RUN_KINDS,
  githubActions,
  runs,
  stageExecutions,
} from '../schema/runs.ts';
import type { AgentSession, GithubAction, Run, StageExecution } from './runs.ts';
import type { PullRequest, Repository } from './repositories.ts';

export async function getRun(db: Executor, runId: number): Promise<Run | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  return row ?? null;
}

/** The run row, locked until the transaction ends (serialises work on one run). */
export async function lockRun(db: Executor, runId: number): Promise<Run | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId)).for('update');
  return row ?? null;
}

/** The PR's queued or running round or implementer run (the one that holds the PR). */
export async function activeBlockingRun(db: Executor, pullRequestId: number): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.pullRequestId, pullRequestId),
        inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
        inArray(runs.kind, [...BLOCKING_RUN_KINDS]),
      ),
    )
    .orderBy(desc(runs.id))
    .limit(1);
  return row ?? null;
}

/** Whether a round of the PR was created after `since` (any status). */
export async function roundCreatedSince(
  db: Executor,
  pullRequestId: number,
  since: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.pullRequestId, pullRequestId), eq(runs.kind, 'round'), gt(runs.createdAt, since)),
    )
    .limit(1);
  return row !== undefined;
}

/** Runs in the given statuses, oldest first. */
export async function runsWithStatus(
  db: Executor,
  statuses: readonly Run['status'][],
): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(inArray(runs.status, [...statuses]))
    .orderBy(asc(runs.id));
}

/** A run with the PR and repository it belongs to. */
export async function getRunContext(
  db: Executor,
  runId: number,
): Promise<{ run: Run; pullRequest: PullRequest; repository: Repository } | null> {
  const [row] = await db
    .select({ run: runs, pullRequest: pullRequests, repository: repositories })
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(eq(runs.id, runId));
  return row ?? null;
}

export async function updateStageExecution(
  db: Executor,
  id: number,
  patch: Partial<Omit<StageExecution, 'id' | 'runId' | 'stage' | 'attempt'>>,
): Promise<void> {
  await db.update(stageExecutions).set(patch).where(eq(stageExecutions.id, id));
}

export async function updateRun(
  db: Executor,
  runId: number,
  patch: Partial<Omit<Run, 'id' | 'pullRequestId' | 'kind' | 'createdAt'>>,
): Promise<void> {
  await db.update(runs).set(patch).where(eq(runs.id, runId));
}

/** The run's GitHub action of one kind (for example its after-round `comment`), if any. */
export async function githubActionOfRun(
  db: Executor,
  runId: number,
  kind: string,
): Promise<GithubAction | null> {
  const [row] = await db
    .select()
    .from(githubActions)
    .where(and(eq(githubActions.runId, runId), eq(githubActions.kind, kind)))
    .orderBy(asc(githubActions.id))
    .limit(1);
  return row ?? null;
}

export async function updateGithubAction(
  db: Executor,
  id: number,
  patch: Partial<Pick<GithubAction, 'result' | 'githubId' | 'body'>>,
): Promise<void> {
  await db.update(githubActions).set(patch).where(eq(githubActions.id, id));
}

/** Every stage attempt of a run, by stage and attempt. */
export async function stageExecutionsOfRun(db: Executor, runId: number): Promise<StageExecution[]> {
  return db
    .select()
    .from(stageExecutions)
    .where(eq(stageExecutions.runId, runId))
    .orderBy(asc(stageExecutions.stage), asc(stageExecutions.attempt));
}

/** Adds session costs to the run's total. */
export async function addRunCost(db: Executor, runId: number, usd: number): Promise<void> {
  if (usd === 0) return;
  await db
    .update(runs)
    .set({ costUsd: sql`${runs.costUsd} + ${usd}` })
    .where(eq(runs.id, runId));
}

/** Patches one agent session (live cost per turn, final usage, blob keys). */
export async function updateAgentSession(
  db: Executor,
  id: number,
  patch: Partial<Omit<AgentSession, 'id' | 'stageExecutionId' | 'createdAt'>>,
): Promise<void> {
  await db.update(agentSessions).set(patch).where(eq(agentSessions.id, id));
}

/** Sessions of a stage execution still marked running get `status` (after a restart). */
export async function endRunningSessions(
  db: Executor,
  stageExecutionId: number,
  status: string,
): Promise<void> {
  await db
    .update(agentSessions)
    .set({ status })
    .where(
      and(
        eq(agentSessions.stageExecutionId, stageExecutionId),
        eq(agentSessions.status, 'running'),
      ),
    );
}
