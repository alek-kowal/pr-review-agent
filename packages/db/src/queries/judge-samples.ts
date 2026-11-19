// P-26: the stored judge calls `pnpm judge:compare` replays. Reads only.
import type { ChangeType } from '@pra/core';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { agentSessions, runs, stageExecutions } from '../schema/runs.ts';

/** One PR's latest stored judge call, with the type a person forced on it, if any. */
export type JudgeSample = {
  pullRequestId: number;
  repository: string;
  prNumber: number;
  /** The reference: the change type a person forced ("Force type"); null without one. */
  forced: ChangeType | null;
  /** The rules' floor that run had (the stage output), to apply as the stage would. */
  floor: ChangeType | null;
  /** The model that call used and the stored message (a blob key). */
  model: string;
  promptBlobKey: string;
};

/**
 * The latest judge call of each PR that has one stored, PRs with a forced type first (they can
 * be scored), then the newest; at most `limit`.
 */
export async function judgeSamples(
  db: Reader,
  { limit }: { limit: number },
): Promise<JudgeSample[]> {
  const latest = await db
    .selectDistinctOn([pullRequests.id], {
      pullRequestId: pullRequests.id,
      repository: repositories.githubFullName,
      prNumber: pullRequests.number,
      forced: pullRequests.forcedChangeType,
      output: stageExecutions.output,
      sessionId: agentSessions.id,
      model: agentSessions.model,
      promptBlobKey: agentSessions.promptBlobKey,
    })
    .from(agentSessions)
    .innerJoin(stageExecutions, eq(stageExecutions.id, agentSessions.stageExecutionId))
    .innerJoin(runs, eq(runs.id, stageExecutions.runId))
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      and(
        eq(agentSessions.role, 'judge'),
        eq(stageExecutions.stage, 'change_type'),
        isNotNull(agentSessions.promptBlobKey),
      ),
    )
    .orderBy(pullRequests.id, desc(agentSessions.id));

  return latest
    .sort((a, b) => Number(!!b.forced) - Number(!!a.forced) || b.sessionId - a.sessionId)
    .slice(0, limit)
    .map((row) => ({
      pullRequestId: row.pullRequestId,
      repository: row.repository,
      prNumber: row.prNumber,
      forced: row.forced ?? null,
      floor: floorOf(row.output),
      model: row.model,
      promptBlobKey: row.promptBlobKey!,
    }));
}

/** What a read-only caller gets: queries, `select distinct on` included. */
export type Reader = Executor & Pick<Db, 'selectDistinctOn'>;

/** Runs `fn` in a read-only transaction: any write in it fails. */
export async function readOnly<T>(db: Db, fn: (tx: Reader) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return fn(tx);
  });
}

function floorOf(output: unknown): ChangeType | null {
  const rules = (output as { rules?: { changeType?: unknown } } | null)?.rules;
  const type = rules?.changeType;
  return type === 'uses_existing' || type === 'changes_behaviour' || type === 'one_way_door'
    ? type
    : null;
}
