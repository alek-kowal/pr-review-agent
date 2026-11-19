// ClickUp follow-up tasks of findings deferred to ClickUp (S-06-T5), stored on their
// `finding_decisions` rows.
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { findings } from '../schema/runs.ts';
import { decisionBatches, findingDecisions, type FollowUpStatus } from '../schema/team.ts';
import type { Transactor } from './decisions.ts';
import type { PullRequest, Repository } from './repositories.ts';

export type FollowUpReason = { code: string; params: Record<string, unknown> };

/** A deferred finding of one batch with what its follow-up task needs. */
export type FollowUpItem = {
  findingId: number;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
  suggestion: string;
  status: FollowUpStatus | null;
};

/** The findings a batch decided, with their follow-up state, by finding id. */
export async function followUpItems(db: Executor, batchId: number): Promise<FollowUpItem[]> {
  return db
    .select({
      findingId: findings.id,
      title: findings.title,
      file: findings.file,
      line: findings.line,
      scenario: findings.scenario,
      suggestion: findings.suggestion,
      status: findingDecisions.followUpStatus,
    })
    .from(findingDecisions)
    .innerJoin(findings, eq(findings.id, findingDecisions.findingId))
    .where(eq(findingDecisions.batchId, batchId))
    .orderBy(asc(findings.id));
}

export type FollowUpClaim = 'claimed' | 'undone' | 'already_created';

/**
 * Marks one finding's follow-up `creating` under the batch's row lock (the lock Undo takes), so
 * an Undo that won the lock stops it and one that comes later cannot interleave. A `creating`
 * or `created` row is never claimed again: a crash while creating leaves `creating`, and no
 * second task is made.
 */
export async function claimFollowUp(
  db: Transactor,
  batchId: number,
  findingId: number,
): Promise<FollowUpClaim> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select({ undoneAt: decisionBatches.undoneAt, decision: decisionBatches.decision })
      .from(decisionBatches)
      .where(eq(decisionBatches.id, batchId))
      .for('update');
    if (!batch || batch.undoneAt || batch.decision !== 'defer') return 'undone';
    const claimed = await tx
      .update(findingDecisions)
      .set({ followUpStatus: 'creating', followUpError: null })
      .where(
        and(
          eq(findingDecisions.batchId, batchId),
          eq(findingDecisions.findingId, findingId),
          or(
            isNull(findingDecisions.followUpStatus),
            eq(findingDecisions.followUpStatus, 'failed'),
          ),
        ),
      )
      .returning({ findingId: findingDecisions.findingId });
    return claimed.length ? 'claimed' : 'already_created';
  });
}

/** Stores the created task, or why there is none. */
export async function recordFollowUp(
  db: Executor,
  batchId: number,
  findingId: number,
  result: { task: { id: string; url: string } } | { error: FollowUpReason },
): Promise<void> {
  await db
    .update(findingDecisions)
    .set(
      'task' in result
        ? {
            followUpStatus: 'created',
            followUpTaskId: result.task.id,
            followUpUrl: result.task.url,
            followUpError: null,
          }
        : { followUpStatus: 'failed', followUpError: result.error },
    )
    .where(and(eq(findingDecisions.batchId, batchId), eq(findingDecisions.findingId, findingId)));
}

export type FollowUpView = {
  status: FollowUpStatus | null;
  taskId: string | null;
  url: string | null;
  error: FollowUpReason | null;
};

/** The follow-up of each finding in these (batch, finding) pairs, keyed `<batchId>:<findingId>`. */
export async function followUpsOf(
  db: Executor,
  pairs: readonly { batchId: number; findingId: number }[],
): Promise<Map<string, FollowUpView>> {
  if (pairs.length === 0) return new Map();
  const rows = await db
    .select({
      batchId: findingDecisions.batchId,
      findingId: findingDecisions.findingId,
      status: findingDecisions.followUpStatus,
      taskId: findingDecisions.followUpTaskId,
      url: findingDecisions.followUpUrl,
      error: findingDecisions.followUpError,
    })
    .from(findingDecisions)
    .where(
      and(
        inArray(findingDecisions.batchId, [...new Set(pairs.map((p) => p.batchId))]),
        inArray(findingDecisions.findingId, [...new Set(pairs.map((p) => p.findingId))]),
      ),
    );
  return new Map(rows.map(({ batchId, findingId, ...view }) => [`${batchId}:${findingId}`, view]));
}

/**
 * Defer batches decided between `from` and `to`, not undone, with a finding whose follow-up job
 * never ran: the worker resends their job when the api's send was lost.
 */
export async function deferBatchesWithoutFollowUp(
  db: Executor,
  window: { from: Date; to: Date },
): Promise<number[]> {
  const rows = await db
    .select({ id: decisionBatches.id })
    .from(decisionBatches)
    .innerJoin(findingDecisions, eq(findingDecisions.batchId, decisionBatches.id))
    .where(
      and(
        eq(decisionBatches.decision, 'defer'),
        isNull(decisionBatches.undoneAt),
        gte(decisionBatches.createdAt, window.from),
        lte(decisionBatches.createdAt, window.to),
        isNull(findingDecisions.followUpStatus),
      ),
    );
  return [...new Set(rows.map((row) => row.id))];
}

/** A pull request by id with its repository. */
export async function pullRequestAndRepository(
  db: Executor,
  pullRequestId: number,
): Promise<{ pullRequest: PullRequest; repository: Repository } | null> {
  const [row] = await db
    .select({ pullRequest: pullRequests, repository: repositories })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(eq(pullRequests.id, pullRequestId));
  return row ?? null;
}
