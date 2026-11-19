// `pull_request` events (S-01-T6): keep the PR snapshot, start round 1 when core says so, then
// run the PR event hooks.
import { roundStartForEvent } from '@pra/core';
import {
  activeBlockingRun,
  getPullRequest,
  getRepositoryByFullName,
  readRepositoryConfig,
  setRepositoryInstallationId,
  upsertPullRequest,
  type PullRequest,
  type PullRequestSnapshot,
} from '@pra/db';
import { toPullRequest, type GitHubPullRequest, type RawPullRequest } from '@pra/integrations';
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

  const config = readRepositoryConfig(repository).value;
  const decision = roundStartForEvent(
    { action },
    {
      state: pullRequest.state,
      draft: pullRequest.isDraft,
      fork: pullRequest.isFork,
      level: config.defaultLevel,
    },
    await activeBlockingRun(db, pullRequest.id),
  );

  let outcome: string = decision.reason.code;
  if (decision.start) {
    const result = await startRound(deps, {
      pullRequest,
      level: decision.level,
      trigger: decision.trigger,
      startedBy: decision.startedBy,
      roundNumber: decision.roundNumber,
    });
    outcome = result.started ? 'round_started' : result.reason;
  }

  if (!stale) {
    for (const kind of prEventKinds(action, snapshot, previous)) {
      for (const hook of deps.extensions.prEventHooks[kind]) {
        await hook({ deps, repository, pullRequest, previous, snapshot, action, eventId: event.id });
      }
    }
  }
  return outcome;
}

function toSnapshotRow(repositoryId: number, pr: GitHubPullRequest): PullRequestSnapshot {
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
