// S-12-T3: keep the merge checklist fresh. CI events (`check_suite`, `check_run`, `status`) name a
// commit: the CI of every open PR at that head is read again from GitHub and stored. A
// `pull_request_review` reads that PR's reviews again and stores who requests changes. Reading
// GitHub's current state, not the event, makes late or repeated deliveries harmless.
import {
  ciChecksOf,
  getPullRequest,
  getRepositoryByFullName,
  openPullRequestsAtHead,
  storeChangesRequested,
  storePrCi,
} from '@pra/db';
import type { GitHubEventContext, GitHubEventHandler } from './index.ts';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function repositoryName({ event, payload }: GitHubEventContext): string | null {
  return text(record(payload.repository).full_name) ?? event.repositoryFullName ?? null;
}

/** A handler that refreshes the CI of the open PRs at the commit `shaOf` reads from the payload. */
function ciEvent(shaOf: (payload: Record<string, unknown>) => unknown): GitHubEventHandler {
  return async (context) => {
    const { deps, payload } = context;
    const sha = text(shaOf(payload));
    const fullName = repositoryName(context);
    if (!sha || !fullName) return 'payload_invalid';
    const repository = await getRepositoryByFullName(deps.db, fullName);
    if (!repository) return 'repository_not_connected';
    const pullRequests = await openPullRequestsAtHead(deps.db, repository.id, sha);
    if (pullRequests.length === 0) return 'no_pull_request';
    const checks = ciChecksOf(await deps.github.getCiStatus(repository.githubFullName, sha));
    for (const pullRequest of pullRequests) {
      await storePrCi(deps.db, pullRequest.id, { sha, checks });
    }
    return 'ci_refreshed';
  };
}

export const handleCheckSuiteEvent = ciEvent((payload) => record(payload.check_suite).head_sha);
export const handleCheckRunEvent = ciEvent((payload) => record(payload.check_run).head_sha);
export const handleStatusEvent = ciEvent((payload) => payload.sha);

export const handlePullRequestReviewEvent: GitHubEventHandler = async (context) => {
  const { deps, payload } = context;
  const number = record(payload.pull_request).number;
  const fullName = repositoryName(context);
  if (typeof number !== 'number' || !fullName) return 'payload_invalid';
  const repository = await getRepositoryByFullName(deps.db, fullName);
  if (!repository) return 'repository_not_connected';
  const pullRequest = await getPullRequest(deps.db, repository.id, number);
  if (!pullRequest) return 'no_pull_request';
  const logins = await deps.github.listChangesRequested(repository.githubFullName, number);
  await storeChangesRequested(deps.db, pullRequest.id, logins);
  return 'reviews_refreshed';
};
