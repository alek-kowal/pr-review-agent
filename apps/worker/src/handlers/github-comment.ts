// The after-round GitHub comment (S-01-T11, FR-027): one sentence per completed round, posted at
// most once per run. No URL and no finding text: a repository's PRs may be public (NFR Privacy).
import { BOT, githubReadOnly } from '@pra/core';
import {
  getAppSettings,
  getRunContext,
  githubActionOfRun,
  insertGithubAction,
  JOBS,
  lockRun,
  recordTimelineEntry,
  sendJob,
  updateGithubAction,
  type Executor,
  type QueueJob,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import type { RunHook } from '../run/hooks.ts';

export const COMMENT_ACTION = 'comment';

export const afterRoundComment = (roundNumber: number): string =>
  `Ready for team member review (round ${roundNumber})`;

const enabled = async (db: Executor): Promise<boolean> =>
  (await getAppSettings(db)).value.afterRoundGithubComment;

/** `runCompleted` hook: queues the comment for a completed round when the setting is on. */
export const enqueueAfterRoundComment: RunHook = async ({ deps, run }) => {
  if (run.kind !== 'round' || run.status !== 'completed') return;
  // Without the GitHub App nothing is posted (P-28).
  if (githubReadOnly(deps.github.mode)) return;
  if (!(await enabled(deps.db))) return;
  await sendJob(deps.queue, JOBS.githubComment, { runId: run.id }, { singletonKey: `${run.id}` });
};

export async function handleGithubComments(
  deps: WorkerDeps,
  jobs: QueueJob<'github.comment'>[],
): Promise<void> {
  for (const job of jobs) await postAfterRoundComment(deps, job.data.runId);
}

export type CommentOutcome =
  | 'posted'
  | 'run_not_found'
  | 'not_a_completed_round'
  | 'comment_off'
  | 'already_posted'
  | 'github_read_only';

/**
 * Claims the run's `comment` action (`sending`) under the run's row lock, posts, then records
 * `posted` with GitHub's id, or `failed` and rethrows so pg-boss retries (a retry claims the
 * `failed` row again). A `sending` or `posted` row is never posted again: a crash while sending
 * leaves `sending`, and the comment is not repeated on a public PR.
 */
export async function postAfterRoundComment(
  deps: WorkerDeps,
  runId: number,
): Promise<CommentOutcome> {
  const { db, logger } = deps;
  // A job queued before a switch away from the App: skipped, not failed, so it is not retried.
  if (githubReadOnly(deps.github.mode)) {
    logger.info({ runId, outcome: 'github_read_only' }, 'after-round comment skipped');
    return 'github_read_only';
  }
  const found = await getRunContext(db, runId);
  if (!found) return 'run_not_found';
  const { pullRequest, repository } = found;

  const claim = await db.transaction(async (tx) => {
    const run = await lockRun(tx, runId);
    if (!run || run.kind !== 'round' || run.status !== 'completed' || run.roundNo === null) {
      return 'not_a_completed_round' as const;
    }
    if (!(await enabled(tx))) return 'comment_off' as const;
    const existing = await githubActionOfRun(tx, runId, COMMENT_ACTION);
    if (existing && existing.result !== 'failed') return 'already_posted' as const;

    const body = afterRoundComment(run.roundNo);
    if (existing) {
      await updateGithubAction(tx, existing.id, { result: 'sending', body });
      return { id: existing.id, body };
    }
    const row = await insertGithubAction(tx, {
      pullRequestId: pullRequest.id,
      runId,
      kind: COMMENT_ACTION,
      body,
      result: 'sending',
    });
    return { id: row.id, body };
  });
  if (typeof claim === 'string') {
    logger.info({ runId, outcome: claim }, 'after-round comment skipped');
    return claim;
  }

  let posted: { id: number };
  try {
    posted = await deps.github.postIssueComment(
      repository.githubFullName,
      pullRequest.number,
      claim.body,
    );
  } catch (error) {
    await updateGithubAction(db, claim.id, { result: 'failed' });
    logger.warn({ err: error, runId }, 'after-round comment failed');
    throw error;
  }
  // The comment is on GitHub now. If recording that (and its timeline entry) fails, the row stays
  // `sending`, so a retry never posts it a second time.
  await db.transaction(async (tx) => {
    await updateGithubAction(tx, claim.id, { result: 'posted', githubId: posted.id });
    await recordTimelineEntry(tx, {
      pullRequestId: pullRequest.id,
      actor: BOT,
      kind: 'github_comment_posted',
      params: { body: claim.body },
      runId,
      sourceKey: `github_action:${claim.id}`,
    });
  });
  logger.info({ runId, pr: pullRequest.number }, 'after-round comment posted');
  return 'posted';
}
