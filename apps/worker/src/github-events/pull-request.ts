// `pull_request` events (S-01-T6): keep the PR snapshot, start round 1 when core says so, then
// run the PR event hooks.
import { roundStartForEvent } from '@pra/core';
import {
  activeBlockingRun,
  getAppSettings,
  getPullRequest,
  getRepositoryByFullName,
  prLevel,
  roundCreatedSince,
  setGithubEventOutcome,
  setRepositoryInstallationId,
  upsertPullRequest,
  type PullRequest,
  type PullRequestSnapshot,
} from '@pra/db';
import { toPullRequest, type GitHubPullRequest, type RawPullRequest } from '@pra/integrations';
import { startFixCheckOnPush } from '../run/chains.ts';
import { startRound } from '../run/start-round.ts';
import type { GitHubEventContext } from './index.ts';
import { prEventKinds } from './pr-hooks.ts';

export async function handlePullRequestEvent({
  deps,
  event,
  payload,
}: GitHubEventContext): Promise<string> {
  const { db } = deps;
  const raw = payload.pull_request as RawPullRequest | undefined;
  const action = event.action ?? (typeof payload.action === 'string' ? payload.action : '');
  if (!raw?.base?.repo?.full_name || !raw.head) return 'payload_invalid';
  const snapshot = toPullRequest(raw);

  const repository = await getRepositoryByFullName(db, snapshot.fullName);
  if (!repository) return 'repository_not_connected';

  const installationId = (payload.installation as { id?: unknown } | undefined)?.id;
  if (typeof installationId === 'number' && installationId !== repository.installationId) {
    await setRepositoryInstallationId(db, repository.id, installationId);
  }

  const previous = await getPullRequest(db, repository.id, snapshot.number);
  // GitHub may deliver out of order: an older snapshot never replaces a newer one.
  const stale = previous !== null && previous.updatedAt.getTime() > Date.parse(snapshot.updatedAt);
  const pullRequest: PullRequest = stale
    ? previous
    : (await upsertPullRequest(db, toSnapshotRow(repository.id, snapshot))).pullRequest;

  const decision = roundStartForEvent(
    { action },
    {
      state: pullRequest.state,
      // A late delivery speaks for the moment it was sent: a draft then was not ready then.
      draft: pullRequest.isDraft || (stale && snapshot.isDraft),
      fork: pullRequest.isFork,
      level: prLevel(repository, pullRequest, (await getAppSettings(db)).value.defaultLevel),
    },
    await activeBlockingRun(db, pullRequest.id),
  );

  let outcome: string = decision.reason.code;
  if (event.outcome === 'round_started') {
    // A retry of this event (a hook threw, or the worker stopped): its round already exists.
    outcome = 'round_started';
  } else if (
    decision.start &&
    stale &&
    (await roundCreatedSince(db, pullRequest.id, new Date(snapshot.updatedAt)))
  ) {
    // A round started after this delivery was sent already covers it.
    outcome = 'event_stale';
  } else if (decision.start) {
    const result = await startRound(deps, {
      pullRequestId: pullRequest.id,
      level: decision.level,
      trigger: decision.trigger,
      startedBy: decision.startedBy,
      inTransaction: (tx) => setGithubEventOutcome(tx, event.id, 'round_started'),
    });
    outcome = result.started ? 'round_started' : result.reason.code;
  } else if (action === 'synchronize' && !stale) {
    // A push never starts a review, except the fix PR Review Agent pushed (FR-016).
    const result = await startFixCheckOnPush(deps, pullRequest, (tx) =>
      setGithubEventOutcome(tx, event.id, 'round_started'),
    );
    if (result) outcome = result.started ? 'round_started' : result.reason.code;
  }

  if (!stale) {
    for (const kind of prEventKinds(action, snapshot, previous)) {
      for (const hook of deps.extensions.prEventHooks[kind]) {
        await hook({
          deps,
          repository,
          pullRequest,
          previous,
          snapshot,
          action,
          eventId: event.id,
          payload,
        });
      }
    }
  }
  return outcome;
}

/** GitHub's PR as the stored snapshot row (the webhook and the reconcile poll alike). */
export function toSnapshotRow(repositoryId: number, pr: GitHubPullRequest): PullRequestSnapshot {
  return {
    repositoryId,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    authorLogin: pr.authorLogin,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    isDraft: pr.isDraft,
    isFork: pr.isFork,
    state: pr.state,
    commitsCount: pr.commitsCount,
    openedAt: new Date(pr.openedAt),
    updatedAt: new Date(pr.updatedAt),
  };
}
