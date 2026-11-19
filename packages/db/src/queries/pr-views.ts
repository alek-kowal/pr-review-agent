// Reads behind the PR list and the PR page. They never write.
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { agentSessions, findings, questions, runs, stageExecutions } from '../schema/runs.ts';
import type { PullRequest, Repository } from './repositories.ts';
import type { AgentSession, FindingRow, QuestionRow, Run, StageExecution } from './runs.ts';

export type PullRequestListItem = {
  repositorySlug: string;
  pullRequest: PullRequest;
  /** Status of the PR's latest round; null when it never had one. */
  latestRoundStatus: Run['status'] | null;
};

/** Open PRs (drafts included) of connected repositories, newest GitHub activity first. */
export async function listOpenPullRequests(
  db: Executor,
  filter: { repositoryId?: number } = {},
): Promise<PullRequestListItem[]> {
  const latestRound = sql<Run['status'] | null>`(
    select ${runs.status} from ${runs}
    where ${runs.pullRequestId} = ${pullRequests.id} and ${runs.kind} = 'round'
    order by ${runs.createdAt} desc, ${runs.id} desc
    limit 1
  )`;
  const rows = await db
    .select({
      repositorySlug: repositories.slug,
      pullRequest: pullRequests,
      latestRoundStatus: latestRound,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      and(
        eq(pullRequests.state, 'open'),
        filter.repositoryId === undefined
          ? undefined
          : eq(pullRequests.repositoryId, filter.repositoryId),
      ),
    )
    .orderBy(desc(pullRequests.updatedAt), asc(repositories.slug), desc(pullRequests.number));
  return rows;
}

/** A PR by repository slug and number, with its repository. */
export async function findPullRequest(
  db: Executor,
  slug: string,
  number: number,
): Promise<{ repository: Repository; pullRequest: PullRequest } | null> {
  const [row] = await db
    .select({ repository: repositories, pullRequest: pullRequests })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(and(eq(repositories.slug, slug), eq(pullRequests.number, number)));
  return row ?? null;
}

/** The PR's most recent round (any status), or its most recent completed one. */
export async function latestRound(
  db: Executor,
  pullRequestId: number,
  options: { completed?: boolean } = {},
): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.pullRequestId, pullRequestId),
        eq(runs.kind, 'round'),
        options.completed ? eq(runs.status, 'completed') : undefined,
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return row ?? null;
}

/** Every attempt of every stage of a run, oldest first. */
export async function stageExecutionsOf(db: Executor, runId: number): Promise<StageExecution[]> {
  return db
    .select()
    .from(stageExecutions)
    .where(eq(stageExecutions.runId, runId))
    .orderBy(asc(stageExecutions.attempt), asc(stageExecutions.id));
}

export async function findingsOf(db: Executor, runId: number): Promise<FindingRow[]> {
  return db.select().from(findings).where(eq(findings.runId, runId)).orderBy(asc(findings.ordinal));
}

export async function questionsOf(db: Executor, runId: number): Promise<QuestionRow[]> {
  return db
    .select()
    .from(questions)
    .where(eq(questions.runId, runId))
    .orderBy(asc(questions.ordinal));
}

/** Every run of a PR, oldest first (chain labels). */
export async function runsOfPullRequest(db: Executor, pullRequestId: number): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(eq(runs.pullRequestId, pullRequestId))
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/** One agent session of a run, or null when the session belongs to another run. */
export async function sessionOfRun(
  db: Executor,
  runId: number,
  sessionId: number,
): Promise<AgentSession | null> {
  const [row] = await db
    .select({ session: agentSessions })
    .from(agentSessions)
    .innerJoin(stageExecutions, eq(stageExecutions.id, agentSessions.stageExecutionId))
    .where(and(eq(agentSessions.id, sessionId), eq(stageExecutions.runId, runId)));
  return row?.session ?? null;
}

export type ActiveRunRow = {
  run: Run;
  pullRequest: PullRequest;
  repositorySlug: string;
};

/** Queued and running runs of every PR, oldest first (Activity → In progress). */
export async function activeRuns(db: Executor): Promise<ActiveRunRow[]> {
  return db
    .select({ run: runs, pullRequest: pullRequests, repositorySlug: repositories.slug })
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(inArray(runs.status, ['queued', 'running']))
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/** Cost of every agent session created at or after `since` (today's spend). */
export async function spendSince(db: Executor, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${agentSessions.costUsd}), 0)` })
    .from(agentSessions)
    .where(gte(agentSessions.createdAt, since));
  return Number(row?.total ?? 0);
}
