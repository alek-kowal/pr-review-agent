/** Everything the app asks of GitHub, as the GitHub App `pr-review-agent`. */
export interface GitHubGateway {
  /** Checks `X-Hub-Signature-256` against the raw request body. A missing signature is `false`. */
  verifyWebhook(rawBody: string | Uint8Array, signature: string | undefined): Promise<boolean>;
  /** The App's installation on a repository, or `null` when the App is not installed there. */
  getRepoInstallationId(fullName: string): Promise<number | null>;
  /** An installation token, reused until shortly before it expires. */
  getInstallationToken(installationId: number): Promise<InstallationToken>;
  getPullRequest(fullName: string, number: number): Promise<GitHubPullRequest>;
  /** Posts `body` unchanged as a comment on the PR's conversation. */
  postIssueComment(fullName: string, number: number, body: string): Promise<{ id: number }>;
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
