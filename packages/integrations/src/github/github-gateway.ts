/** Everything the app asks of GitHub, as the GitHub App `pr-review-agent`. */
export interface GitHubGateway {
  /** The App's env vars that are missing (`GITHUB_ENV`); empty when it is configured. */
  readonly missingEnv: readonly string[];
  /** Checks `X-Hub-Signature-256` against the raw request body. A missing signature is `false`. */
  verifyWebhook(rawBody: string | Uint8Array, signature: string | undefined): Promise<boolean>;
  /** The App's installation on a repository, or `null` when the App is not installed there. */
  getRepoInstallationId(fullName: string): Promise<number | null>;
  /** An installation token, reused until shortly before it expires. */
  getInstallationToken(installationId: number): Promise<InstallationToken>;
  getPullRequest(fullName: string, number: number): Promise<GitHubPullRequest>;
  /** Posts `body` unchanged as a comment on the PR's conversation. */
  postIssueComment(fullName: string, number: number, body: string): Promise<{ id: number }>;
  /** CI on one commit: its check runs plus its combined commit status, counted. */
  getCiStatus(fullName: string, sha: string): Promise<CiStatus>;
  /** Every repository the App can reach, across all its installations, sorted by full name. */
  listAccessibleRepositories(): Promise<AccessibleRepository[]>;
  /** How `head` relates to `base`: commits `head` has that `base` lacks, and the reverse. */
  compareCommits(fullName: string, base: string, head: string): Promise<CommitComparison>;
  /** One commit's parents and message (metric 5 tells "Update branch" merges apart). */
  getCommit(fullName: string, sha: string): Promise<GitHubCommit>;
  /** The PR as GitHub sees it right now: head, open or merged, and GitHub's mergeable state. */
  getPullRequestState(fullName: string, number: number): Promise<PullRequestFreshState>;
  /** GitHub logins whose latest review on the PR requests changes. */
  listChangesRequested(fullName: string, number: number): Promise<string[]>;
  /**
   * What people wrote on the PR (the analyst's input): line comments, conversation comments and
   * review bodies, oldest first. Comments by bots (the App's own included) are left out.
   */
  listReviewComments(fullName: string, number: number): Promise<GitHubComment[]>;
  /**
   * Squash-merges the PR as the App, pinned to `sha`: GitHub refuses when the head moved. Branch
   * protection applies; nothing here bypasses it. A refusal (405, 409, 422) is an answer with
   * GitHub's status and message; any other failure throws.
   */
  squashMerge(merge: SquashMerge): Promise<MergeResult>;
}

export type PullRequestFreshState = {
  headSha: string;
  state: PullRequestState;
  /** GitHub's `mergeable_state` (`clean`, `blocked`, `behind`, `dirty`, `unknown`, ...). */
  mergeableState: string;
};

export type SquashMerge = {
  fullName: string;
  number: number;
  /** The reviewed commit; GitHub merges only while it is the PR's head. */
  sha: string;
  title: string;
  message: string;
};

export type MergeResult =
  { merged: true; sha: string } | { merged: false; status: number; message: string };

/** GitHub's answers to a merge that are a refusal, not a failure. */
export const MERGE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([405, 409, 422]);

/** One review as GitHub lists it (`GET /pulls/{n}/reviews`, oldest first). */
export type PullRequestReview = { login: string; state: string };

/** One comment by a person on a PR; `path` and `line` only for a line comment. */
export type GitHubComment = {
  /** `review_comment:<id>`, `issue_comment:<id>` or `review:<id>`. */
  id: string;
  /** The author's GitHub login. */
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: string;
};

/**
 * Logins whose latest review requests changes. A later approval or dismissal replaces an earlier
 * request; comments (and pending reviews) do not.
 */
export function changesRequestedBy(reviews: readonly PullRequestReview[]): string[] {
  const latest = new Map<string, string>();
  for (const { login, state } of reviews) {
    if (state === 'COMMENTED' || state === 'PENDING') continue;
    latest.set(login, state);
  }
  return [...latest]
    .filter(([, state]) => state === 'CHANGES_REQUESTED')
    .map(([login]) => login)
    .sort();
}

/** GitHub's compare of two commits (`GET /repos/{owner}/{repo}/compare/{base}...{head}`). */
export type CommitComparison = {
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  aheadBy: number;
  behindBy: number;
};

export type GitHubCommit = { sha: string; parents: string[]; message: string };

/** A repository one of the App's installations can act on. */
export type AccessibleRepository = {
  fullName: string;
  installationId: number;
  /** The account the installation belongs to (user or organization login). */
  account: string;
  defaultBranch: string;
  private: boolean;
};

export type CiState = 'passed' | 'failed' | 'pending';

/** One check run or one commit status context. */
export type CiCheck = { name: string; source: 'check_run' | 'status'; state: CiState };

export type CiStatus = {
  passed: number;
  failed: number;
  pending: number;
  total: number;
  checks: CiCheck[];
};

/** A check run's state: not completed is pending; a failing conclusion is failed. */
export function checkRunState(run: { status: string; conclusion: string | null }): CiState {
  if (run.status !== 'completed') return 'pending';
  switch (run.conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'passed';
    case 'stale':
    case null:
      return 'pending';
    default:
      // failure, timed_out, cancelled, action_required, startup_failure
      return 'failed';
  }
}

/** A commit status context's state (`success`, `failure`, `error`, `pending`). */
export function commitStatusState(state: string): CiState {
  if (state === 'success') return 'passed';
  if (state === 'failure' || state === 'error') return 'failed';
  return 'pending';
}

/** Counts the checks by state. */
export function ciStatusOf(checks: CiCheck[]): CiStatus {
  const count = (state: CiState) => checks.filter((check) => check.state === state).length;
  return {
    passed: count('passed'),
    failed: count('failed'),
    pending: count('pending'),
    total: checks.length,
    checks,
  };
}

export type InstallationToken = { token: string; expiresAt: Date };

export type PullRequestState = 'open' | 'closed' | 'merged';

/** The PR snapshot the app keeps; the same shape comes from the REST API and from webhooks. */
export type GitHubPullRequest = {
  /** `owner/name` of the base repository. */
  fullName: string;
  number: number;
  title: string;
  body: string;
  authorLogin: string;
  htmlUrl: string;
  headSha: string;
  headRef: string;
  /** `null` when the head repository was deleted. */
  headRepoFullName: string | null;
  baseSha: string;
  baseRef: string;
  isDraft: boolean;
  /** The head lives in another repository than the base. */
  isFork: boolean;
  state: PullRequestState;
  commitsCount: number;
  openedAt: string;
  updatedAt: string;
  /** Set once closed; `mergedAt` and `mergeSha` only when merged. */
  closedAt: string | null;
  mergedAt: string | null;
  mergeSha: string | null;
};

export const GITHUB_NOT_CONFIGURED = 'github_not_configured';
export const GITHUB_APP_NOT_INSTALLED = 'github_app_not_installed';
export const GITHUB_ENV = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'GITHUB_WEBHOOK_SECRET',
] as const;

/** The subset of GitHub's `pull_request` object the snapshot reads (REST and webhook alike). */
export type RawPullRequest = {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  draft?: boolean;
  merged?: boolean | null;
  merged_at?: string | null;
  closed_at?: string | null;
  merge_commit_sha?: string | null;
  commits?: number;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { sha: string; ref: string; repo: { full_name: string } };
};

export function toPullRequest(raw: RawPullRequest): GitHubPullRequest {
  const fullName = raw.base.repo.full_name;
  const headRepoFullName = raw.head.repo?.full_name ?? null;
  const merged = raw.merged === true || Boolean(raw.merged_at);
  return {
    fullName,
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    authorLogin: raw.user?.login ?? '',
    htmlUrl: raw.html_url,
    headSha: raw.head.sha,
    headRef: raw.head.ref,
    headRepoFullName,
    baseSha: raw.base.sha,
    baseRef: raw.base.ref,
    isDraft: raw.draft === true,
    isFork: headRepoFullName !== fullName,
    state: merged ? 'merged' : raw.state === 'closed' ? 'closed' : 'open',
    commitsCount: raw.commits ?? 0,
    openedAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? null,
    mergedAt: merged ? (raw.merged_at ?? raw.closed_at ?? raw.updated_at) : null,
    mergeSha: merged ? (raw.merge_commit_sha ?? null) : null,
  };
}

/** `owner/name` → `{ owner, repo }`; anything else is a programming error. */
export function splitFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = fullName.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new TypeError(`Not an owner/name repository: ${JSON.stringify(fullName)}`);
  }
  return { owner, repo };
}
