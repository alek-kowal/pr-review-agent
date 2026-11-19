// S-07-T2: what a push changes. Commits since a review are measured with GitHub's compare (FR-017,
// FR-020); a push never cancels a running round, and only the commit PR Review Agent pushed as a
// fix starts the next round (FR-016).
import { BOT } from '@pra/core';
import {
  and,
  eq,
  getPullRequest,
  getRoundChain,
  schema,
  latestChainOf,
  setChainExpectedHead,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import type { PrEventHook } from '../github-events/pr-hooks.ts';
import type { RunHook } from './hooks.ts';
import { startRound, type StartRoundResult } from './start-round.ts';

/**
 * Stores how many commits the PR head is past the run's head. A failed compare (GitHub down, a
 * force-push dropped the commit) falls back to the difference of the PR's commit counts.
 */
export async function measureCommitsSince(
  deps: Pick<WorkerDeps, 'db' | 'github' | 'logger'>,
  repository: Repository,
  pullRequest: PullRequest,
  run: Run,
): Promise<number> {
  let since = 0;
  if (run.headSha !== pullRequest.headSha) {
    try {
      const comparison = await deps.github.compareCommits(
        repository.githubFullName,
        run.headSha,
        pullRequest.headSha,
      );
      since = comparison.aheadBy;
    } catch (error) {
      deps.logger.warn({ err: error, runId: run.id }, 'compare failed; counting commits instead');
      since = Math.max(0, pullRequest.commitsCount - run.commitsCountAtStart);
    }
  }
  await deps.db
    .update(schema.runs)
    .set({ commitsSince: since, commitsSinceHead: pullRequest.headSha })
    .where(eq(schema.runs.id, run.id));
  return since;
}

/** After a push: the completed rounds of the reviewed chain learn how far behind the head is. */
export const chainsOnHeadChanged: PrEventHook = async ({ deps, repository, pullRequest }) => {
  const completed = await deps.db
    .select()
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.pullRequestId, pullRequest.id),
        eq(schema.runs.kind, 'round'),
        eq(schema.runs.status, 'completed'),
      ),
    )
    .orderBy(schema.runs.createdAt, schema.runs.id);
  const reviewed = completed.at(-1);
  if (!reviewed) return;
  for (const run of completed.filter((r) => r.chainId === reviewed.chainId)) {
    if (run.commitsSinceHead === pullRequest.headSha) continue;
    await measureCommitsSince(deps, repository, pullRequest, run);
  }
};

/**
 * A round that ends on a moved head records the commits since its reviewed SHA (FR-020). The hook's
 * PR was read when the last stage started, so a push during that stage needs the stored PR.
 */
export const chainsOnRunCompleted: RunHook = async ({ deps, run, pullRequest, repository }) => {
  if (run.kind !== 'round') return;
  const current =
    (await getPullRequest(deps.db, pullRequest.repositoryId, pullRequest.number)) ?? pullRequest;
  await measureCommitsSince(deps, repository, current, run);
};

/**
 * A push whose head is the chain's expected head (the fix PR Review Agent pushed) starts the next
 * round as a fix check, unless the chain used its 3 rounds. Any other push starts nothing.
 */
export async function startFixCheckOnPush(
  deps: Pick<WorkerDeps, 'db' | 'queue' | 'logger'>,
  pullRequest: PullRequest,
  inTransaction: Parameters<typeof startRound>[1]['inTransaction'],
): Promise<StartRoundResult | null> {
  const chain = await latestChainOf(deps.db, pullRequest.id);
  if (!chain?.expectedHeadSha || chain.expectedHeadSha !== pullRequest.headSha) return null;
  return startRound(deps, {
    pullRequestId: pullRequest.id,
    trigger: 'own_fix',
    startedBy: BOT,
    inTransaction,
  });
}

/**
 * S-14's push job records the commit it pushed here, after the push. GitHub's `synchronize` for
 * that commit may already have been handled and started nothing; then the fix check starts now.
 * Idempotent: a commit a round of the chain already checked is not expected again.
 */
export async function expectOwnFix(
  deps: Pick<WorkerDeps, 'db' | 'queue' | 'logger'>,
  chainId: string,
  sha: string,
): Promise<StartRoundResult | null> {
  const chain = await getRoundChain(deps.db, chainId);
  if (!chain) return null;
  const [checked] = await deps.db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.chainId, chainId),
        eq(schema.runs.trigger, 'own_fix'),
        eq(schema.runs.headSha, sha),
      ),
    )
    .limit(1);
  if (checked) return null;
  await setChainExpectedHead(deps.db, chainId, sha);
  const [pullRequest] = await deps.db
    .select()
    .from(schema.pullRequests)
    .where(eq(schema.pullRequests.id, chain.pullRequestId));
  // Not there yet: the webhook for the commit starts the round.
  if (pullRequest?.headSha !== sha) return null;
  return startFixCheckOnPush(deps, pullRequest, undefined);
}
