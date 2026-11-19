// S-12: the merge checklist's GitHub inputs (CI and "changes requested") and the merge from the
// app. The merge route holds the PR row for the whole check and GitHub call, so a second merge of
// the same PR waits and then finds it merged.
import { member, type CheckConclusion, type CiCheck } from '@pra/core';
import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests } from '../schema/repositories.ts';
import type { Transactor } from './decisions.ts';
import type { PullRequest } from './repositories.ts';
import { recordStateChange, recordTimelineEntry } from './timeline.ts';

/** A gateway CI check (`passed`, `failed` or `pending`), structurally. */
type GatewayCiCheck = { name: string; state: string };

const CONCLUSION: Record<string, CheckConclusion> = { passed: 'success', failed: 'failure' };

/** Gateway CI to core's checks: passed → success, failed → failure, pending → still running. */
export function ciChecksOf(status: { checks: readonly GatewayCiCheck[] }): CiCheck[] {
  return status.checks.map((check) => ({
    name: check.name,
    conclusion: CONCLUSION[check.state] ?? null,
  }));
}

/** Stores the CI GitHub reported for `sha` on the PR. */
export async function storePrCi(
  db: Executor,
  pullRequestId: number,
  ci: { sha: string; checks: CiCheck[] },
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(pullRequests)
    .set({ ciSha: ci.sha, ciChecks: ci.checks, checksRefreshedAt: at })
    .where(eq(pullRequests.id, pullRequestId));
}

/** Stores the logins whose latest review on the PR requests changes. */
export async function storeChangesRequested(
  db: Executor,
  pullRequestId: number,
  logins: readonly string[],
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(pullRequests)
    .set({ changesRequestedBy: [...logins], checksRefreshedAt: at })
    .where(eq(pullRequests.id, pullRequestId));
}

/** The PR row, locked until the transaction ends; null when it does not exist. */
export async function lockPullRequest(
  tx: Executor,
  pullRequestId: number,
): Promise<PullRequest | null> {
  const [row] = await tx
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.id, pullRequestId))
    .for('update');
  return row ?? null;
}

export type MergedInApp = {
  pullRequestId: number;
  memberId: string;
  /** The reviewed commit the merge was pinned to. */
  sha: string;
  /** GitHub's squash commit. */
  mergeSha: string;
  at?: Date;
};

/**
 * The PR is merged as soon as GitHub says so: state, dates and merge commit, a `pr_merged` entry
 * signed by the member and the state change. GitHub's `updated_at` is left alone, so the `closed`
 * webhook that follows is not stale and its hooks still run.
 */
export async function recordPrMergedInApp(db: Transactor, merged: MergedInApp): Promise<void> {
  const at = merged.at ?? new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(pullRequests)
      .set({ state: 'merged', mergedAt: at, closedAt: at, mergeSha: merged.mergeSha })
      .where(eq(pullRequests.id, merged.pullRequestId));
    await recordTimelineEntry(tx, {
      pullRequestId: merged.pullRequestId,
      actor: member(merged.memberId),
      kind: 'pr_merged',
      params: { via: 'app', sha: merged.sha, mergeSha: merged.mergeSha },
      at,
      sourceKey: `merge:${merged.mergeSha}`,
    });
    await recordStateChange(tx, merged.pullRequestId, { code: 'pr_merged' }, { at });
  });
}

export type MergeRefused = {
  pullRequestId: number;
  memberId: string;
  sha: string;
  /** GitHub's HTTP status and message, verbatim. */
  status: number;
  message: string;
  at?: Date;
};

/** GitHub refused the merge: the entry keeps its reason, signed by the member who tried. */
export async function recordMergeRefused(db: Executor, refused: MergeRefused): Promise<void> {
  const at = refused.at ?? new Date();
  await recordTimelineEntry(db, {
    pullRequestId: refused.pullRequestId,
    actor: member(refused.memberId),
    kind: 'merge_refused',
    params: { sha: refused.sha, status: refused.status, message: refused.message },
    at,
    sourceKey: `merge_refused:${at.getTime()}:${refused.memberId}`,
  });
}
