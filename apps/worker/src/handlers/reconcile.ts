// S-03-T14: the reconcile poll (pg-boss cron, every 10 minutes). Per connected repository it lists
// GitHub's open PRs and corrects what webhooks missed: new PRs (imported), head, draft or ready,
// closed and merged, and the CI of each open PR's head. It never starts a review, also not for a PR it imports (an empty board does
// not auto-review everything; a push never starts a review). Each corrected PR gets a
// `pr_reconciled` timeline entry and a `reconciled` state change; the `pull_requests` write
// publishes the same change notification as a webhook. A PR found closed has its active run
// cancelled as the bot (FR-023).
import { BOT, githubPolls, type CiCheck } from '@pra/core';
import {
  ciChecksOf,
  getPullRequest,
  listRepositories,
  pullRequestsToReconcile,
  recordStateChange,
  recordTimelineEntry,
  storePrCi,
  upsertPullRequest,
  type PullRequest,
  type Repository,
} from '@pra/db';
import type { GitHubPullRequest, OpenPullRequestSummary } from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import { toSnapshotRow } from '../github-events/pull-request.ts';
import { cancelForClosedPr } from '../run/close-cancels.ts';

/** What a poll corrected on one PR, in the order the timeline sentence names them. */
export type Correction =
  'imported' | 'head' | 'draft' | 'ready' | 'closed' | 'merged' | 'reopened' | 'ci';

export type ReconcileResult = {
  /** Corrected PRs as `owner/name#number`. */
  corrected: string[];
  /** Repositories or PRs the poll could not read from GitHub; the next poll tries again. */
  failed: string[];
};

export async function handleReconcile(deps: WorkerDeps): Promise<void> {
  // Without the App the GitHub poller (P-28) watches the PRs and spends the read quota.
  if (githubPolls(deps.github.mode)) return;
  const result = await reconcileRepositories(deps);
  if (result.corrected.length || result.failed.length) {
    deps.logger.info(result, 'reconcile poll corrected PRs');
  }
}

export async function reconcileRepositories(deps: WorkerDeps): Promise<ReconcileResult> {
  const result: ReconcileResult = { corrected: [], failed: [] };
  for (const repository of await listRepositories(deps.db)) {
    try {
      await reconcileRepository(deps, repository, result);
    } catch (error) {
      deps.logger.warn(
        { err: error, repository: repository.githubFullName },
        'reconcile: listing open PRs failed',
      );
      result.failed.push(repository.githubFullName);
    }
  }
  return result;
}

/**
 * Corrects one repository and returns GitHub's list of its open PRs. `importFromList`: a PR the
 * app does not know yet is imported from the list (no commit count) instead of fetched in full,
 * to save requests (the poller's baseline). `ci` false leaves CI alone.
 */
export async function reconcileRepository(
  deps: WorkerDeps,
  repository: Repository,
  result: ReconcileResult,
  options: { importFromList?: boolean; ci?: boolean } = {},
): Promise<OpenPullRequestSummary[]> {
  const fullName = repository.githubFullName;
  const open = await deps.github.listOpenPullRequests(fullName);
  const listed = new Map(open.map((pr) => [pr.number, pr]));
  const stored = new Map(
    (await pullRequestsToReconcile(deps.db, repository.id, [...listed.keys()])).map((pr) => [
      pr.number,
      pr,
    ]),
  );

  // The list has no commit counts, so only a PR that is new or differs is fetched in full.
  const differing = open
    .filter(({ number, headSha, isDraft }) => {
      const pr = stored.get(number);
      return !pr || pr.state !== 'open' || pr.headSha !== headSha || pr.isDraft !== isDraft;
    })
    .map((pr) => pr.number);
  const gone = [...stored.values()]
    .filter((pr) => pr.state === 'open' && !listed.has(pr.number))
    .map((pr) => pr.number);

  for (const number of [...differing, ...gone]) {
    try {
      const previous = stored.get(number) ?? null;
      const fromList = options.importFromList && !previous ? listed.get(number)?.snapshot : null;
      const corrected = await correctPullRequest(deps, repository, previous, number, fromList);
      if (corrected) result.corrected.push(`${fullName}#${number}`);
    } catch (error) {
      deps.logger.warn({ err: error, repository: fullName, number }, 'reconcile: PR not corrected');
      result.failed.push(`${fullName}#${number}`);
    }
  }

  if (options.ci !== false) await correctCi(deps, repository, [...listed.keys()], result);
  return open;
}

/**
 * CI runs without moving the head, so every listed open PR has its head's CI read again (one
 * read per distinct head) and stored when it differs from what the PR shows.
 */
export async function correctCi(
  deps: WorkerDeps,
  repository: Repository,
  numbers: number[],
  result: ReconcileResult,
): Promise<void> {
  const fullName = repository.githubFullName;
  const open = (await pullRequestsToReconcile(deps.db, repository.id, numbers)).filter(
    (pr) => pr.state === 'open' && numbers.includes(pr.number),
  );
  const ciByHead = new Map<string, Promise<CiCheck[]>>();
  for (const pr of open) {
    const key = `${fullName}#${pr.number}`;
    try {
      if (!ciByHead.has(pr.headSha)) {
        ciByHead.set(
          pr.headSha,
          deps.github.getCiStatus(fullName, pr.headSha).then((status) => ciChecksOf(status)),
        );
      }
      const checks = await ciByHead.get(pr.headSha)!;
      const shown = pr.ciSha === pr.headSha ? pr.ciChecks : [];
      if (sameChecks(shown, checks)) continue;
      await deps.db.transaction(async (tx) => {
        await storePrCi(tx, pr.id, { sha: pr.headSha, checks });
        await recordTimelineEntry(tx, {
          pullRequestId: pr.id,
          actor: BOT,
          kind: 'pr_reconciled',
          params: { corrections: ['ci'], headSha: pr.headSha, state: pr.state },
          sourceKey: `reconcile:${pr.id}:ci:${new Date().toISOString()}`,
        });
        await recordStateChange(tx, pr.id, {
          code: 'reconciled',
          params: { corrections: ['ci'] },
        });
      });
      if (!result.corrected.includes(key)) result.corrected.push(key);
    } catch (error) {
      deps.logger.warn(
        { err: error, repository: fullName, number: pr.number },
        'reconcile: CI not read',
      );
      if (!result.failed.includes(key)) result.failed.push(key);
    }
  }
}

const checksKey = (checks: readonly CiCheck[]): string =>
  JSON.stringify(
    [...checks]
      .map(({ name, conclusion }) => [name, conclusion])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );

const sameChecks = (a: readonly CiCheck[], b: readonly CiCheck[]): boolean =>
  checksKey(a) === checksKey(b);

async function correctPullRequest(
  deps: WorkerDeps,
  repository: Repository,
  previous: PullRequest | null,
  number: number,
  listed?: GitHubPullRequest | null,
): Promise<boolean> {
  const snapshot = listed ?? (await deps.github.getPullRequest(repository.githubFullName, number));
  const corrected = await deps.db.transaction(async (tx) => {
    // A webhook may have stored a newer snapshot since the list was read.
    const current = await getPullRequest(tx, repository.id, number);
    if (current && current.updatedAt.getTime() > Date.parse(snapshot.updatedAt)) return null;
    const { pullRequest, changed } = await upsertPullRequest(
      tx,
      toSnapshotRow(repository.id, snapshot),
    );
    const corrections = changed ? correctionsOf(current ?? previous, snapshot) : [];
    if (!corrections.length) return null;
    await recordTimelineEntry(tx, {
      pullRequestId: pullRequest.id,
      actor: BOT,
      kind: 'pr_reconciled',
      params: { corrections, headSha: snapshot.headSha, state: snapshot.state },
      sourceKey: `reconcile:${pullRequest.id}:${snapshot.updatedAt}`,
    });
    await recordStateChange(tx, pullRequest.id, { code: 'reconciled', params: { corrections } });
    return { pullRequest, closed: snapshot.state !== 'open' };
  });
  if (!corrected) return false;
  if (corrected.closed) await cancelForClosedPr(deps, corrected.pullRequest.id);
  return true;
}

function correctionsOf(stored: PullRequest | null, snapshot: GitHubPullRequest): Correction[] {
  if (!stored) return ['imported'];
  const corrections: Correction[] = [];
  if (stored.headSha !== snapshot.headSha) corrections.push('head');
  if (stored.isDraft !== snapshot.isDraft) corrections.push(snapshot.isDraft ? 'draft' : 'ready');
  if (stored.state !== snapshot.state) {
    corrections.push(snapshot.state === 'open' ? 'reopened' : snapshot.state);
  }
  return corrections;
}
