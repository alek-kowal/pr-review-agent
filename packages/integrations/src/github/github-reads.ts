// GitHub's REST reads, shared by the App gateway (installation client) and the token gateway
// (personal token or none). Each takes the Octokit to read with.
import type { Octokit } from '@octokit/core';
import {
  changesRequestedBy,
  checkRunState,
  ciStatusOf,
  commitStatusState,
  splitFullName,
  toPullRequest,
  type CiCheck,
  type CiStatus,
  type CommitComparison,
  type GitHubComment,
  type GitHubCommit,
  type GitHubPullRequest,
  type GitHubUser,
  type OpenPullRequestSummary,
  type PullRequestFreshState,
  type PullRequestReview,
  type RawPullRequest,
  type RepositoryInfo,
} from './github-gateway.ts';

/** GitHub's largest page; lists are read for at most `MAX_PAGES` pages. */
export const PER_PAGE = 100;
export const MAX_PAGES = 10;

export function statusOf(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

export async function readPullRequest(
  octokit: Octokit,
  fullName: string,
  number: number,
): Promise<GitHubPullRequest> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    ...splitFullName(fullName),
    pull_number: number,
  });
  return toPullRequest(data as RawPullRequest);
}

export async function readOpenPullRequests(
  octokit: Octokit,
  fullName: string,
): Promise<OpenPullRequestSummary[]> {
  const open: OpenPullRequestSummary[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      ...splitFullName(fullName),
      state: 'open',
      per_page: PER_PAGE,
      page,
    });
    for (const pr of data) {
      open.push({
        number: pr.number,
        headSha: pr.head.sha,
        isDraft: pr.draft === true,
        updatedAt: pr.updated_at,
        snapshot: toPullRequest(pr as RawPullRequest),
      });
    }
    if (data.length < PER_PAGE) break;
  }
  return open;
}

export async function readComparison(
  octokit: Octokit,
  fullName: string,
  base: string,
  head: string,
): Promise<CommitComparison> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
    ...splitFullName(fullName),
    basehead: `${base}...${head}`,
    // Only the counts are read; one commit per page keeps the response small.
    per_page: 1,
  });
  return { status: data.status, aheadBy: data.ahead_by, behindBy: data.behind_by };
}

export async function readCiStatus(
  octokit: Octokit,
  fullName: string,
  sha: string,
): Promise<CiStatus> {
  const repo = splitFullName(fullName);
  const checks: CiCheck[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
      ...repo,
      ref: sha,
      per_page: PER_PAGE,
      page,
    });
    for (const run of data.check_runs) {
      checks.push({ name: run.name, source: 'check_run', state: checkRunState(run) });
    }
    if (data.check_runs.length < PER_PAGE || checks.length >= data.total_count) break;
  }
  // The combined status already holds the latest state per context.
  const { data: combined } = await octokit.request(
    'GET /repos/{owner}/{repo}/commits/{ref}/status',
    { ...repo, ref: sha, per_page: PER_PAGE },
  );
  for (const status of combined.statuses) {
    checks.push({ name: status.context, source: 'status', state: commitStatusState(status.state) });
  }
  return ciStatusOf(checks);
}

export async function readCommit(
  octokit: Octokit,
  fullName: string,
  sha: string,
): Promise<GitHubCommit> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
    ...splitFullName(fullName),
    ref: sha,
  });
  return {
    sha: data.sha,
    parents: data.parents.map((parent) => parent.sha),
    message: data.commit.message,
  };
}

export async function readPullRequestState(
  octokit: Octokit,
  fullName: string,
  number: number,
): Promise<PullRequestFreshState> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    ...splitFullName(fullName),
    pull_number: number,
  });
  const pr = toPullRequest(data as RawPullRequest);
  return { headSha: pr.headSha, state: pr.state, mergeableState: data.mergeable_state };
}

export async function readChangesRequested(
  octokit: Octokit,
  fullName: string,
  number: number,
): Promise<string[]> {
  const reviews: PullRequestReview[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      { ...splitFullName(fullName), pull_number: number, per_page: PER_PAGE, page },
    );
    for (const review of data) {
      if (review.user) reviews.push({ login: review.user.login, state: review.state });
    }
    if (data.length < PER_PAGE) break;
  }
  return changesRequestedBy(reviews);
}

export async function readReviewComments(
  octokit: Octokit,
  fullName: string,
  number: number,
): Promise<GitHubComment[]> {
  const repo = splitFullName(fullName);
  const comments: GitHubComment[] = [];
  type User = { login: string; type?: string } | null;
  const add = (
    kind: string,
    item: { id: number | bigint; user: User; body?: string | null; created_at?: string | null },
    place: { path?: string | null; line?: number | null } = {},
  ) => {
    if (!item.user || item.user.type === 'Bot' || !item.body?.trim()) return;
    comments.push({
      id: `${kind}:${item.id}`,
      author: item.user.login,
      body: item.body,
      path: place.path ?? null,
      line: place.line ?? null,
      createdAt: item.created_at ?? '',
    });
  };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
      { ...repo, pull_number: number, per_page: PER_PAGE, page },
    );
    for (const c of data) add('review_comment', c, { path: c.path, line: c.line ?? null });
    if (data.length < PER_PAGE) break;
  }
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
      { ...repo, issue_number: number, per_page: PER_PAGE, page },
    );
    for (const c of data) add('issue_comment', c);
    if (data.length < PER_PAGE) break;
  }
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      { ...repo, pull_number: number, per_page: PER_PAGE, page },
    );
    for (const r of data) add('review', { ...r, created_at: r.submitted_at ?? null });
    if (data.length < PER_PAGE) break;
  }
  return comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readUser(octokit: Octokit, login: string): Promise<GitHubUser | null> {
  try {
    const { data } = await octokit.request('GET /users/{username}', { username: login });
    return { id: Number(data.id), login: data.login };
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

/** A repository's name, default branch and visibility; null when GitHub does not show it. */
export async function readRepository(
  octokit: Octokit,
  fullName: string,
): Promise<RepositoryInfo | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}', splitFullName(fullName));
    return { fullName: data.full_name, defaultBranch: data.default_branch, private: data.private };
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}
