// P-28: GitHub until the App exists. Reads with a personal token (`GITHUB_TOKEN`, 5000 requests
// per hour) or with none (public repositories, 60 per hour). Every write is refused before any
// request: the app never acts on GitHub as a person.
import { Octokit } from '@octokit/core';
import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import {
  GITHUB_NOT_CONFIGURED,
  GITHUB_RATE_LIMITED,
  GITHUB_READ_ONLY,
  type AccessibleRepository,
  type CiStatus,
  type CommitComparison,
  type GitHubComment,
  type GitHubCommit,
  type GitHubGateway,
  type GitHubPullRequest,
  type GitHubRateLimit,
  type GitHubUser,
  type InstallationToken,
  type MergeResult,
  type OpenPullRequestSummary,
  type PullRequestFreshState,
  type RepositoryInfo,
} from './github-gateway.ts';
import {
  readChangesRequested,
  readCiStatus,
  readComparison,
  readCommit,
  readOpenPullRequests,
  readPullRequest,
  readPullRequestState,
  readRepository,
  readReviewComments,
  readUser,
  statusOf,
} from './github-reads.ts';

/** Answers kept for conditional requests; the oldest go first beyond this. */
const MAX_CACHED_ANSWERS = 1000;
/** A limit answer without a reset time is waited out this long. */
const FALLBACK_BACKOFF_MS = 60_000;

export type TokenGitHubGatewayOptions = {
  /** The personal token; none reads anonymously. */
  token?: string;
  /** The App's env vars that are missing (shown in Settings; webhooks need them). */
  missingEnv: readonly string[];
  now?: () => number;
  /** Tests answer here; nothing in a test reaches GitHub. */
  fetch?: typeof fetch;
};

type Headers = Record<string, string | number | undefined>;
type Answer = { status: number; url: string; headers: Headers; data: unknown };
type CachedAnswer = { etag: string; response: Answer };
/** Octokit's request options inside a `request` hook. */
type Endpoint = Record<string, unknown> & { method?: string; headers?: Record<string, unknown> };
type Send = (endpoint: Endpoint) => Promise<Answer>;

export class TokenGitHubGateway implements GitHubGateway {
  readonly mode: 'token' | 'anonymous';
  readonly missingEnv: readonly string[];
  readonly #token: string | undefined;
  readonly #octokit: Octokit;
  readonly #now: () => number;
  readonly #answers = new Map<string, CachedAnswer>();
  #rateLimit: GitHubRateLimit | null = null;
  /** No request leaves before this time (ms): GitHub said the limit is used up. */
  #blockedUntil = 0;

  constructor(options: TokenGitHubGatewayOptions) {
    this.#token = options.token?.trim() || undefined;
    this.mode = this.#token ? 'token' : 'anonymous';
    this.missingEnv = [...options.missingEnv];
    this.#now = options.now ?? Date.now;
    this.#octokit = new Octokit({
      ...(this.#token ? { auth: this.#token } : {}),
      userAgent: 'pr-review-agent',
      ...(options.fetch ? { request: { fetch: options.fetch } } : {}),
    });
    // Octokit's hook types are not exported from `@octokit/core`; `Send` and `Endpoint` are the
    // parts this class reads.
    this.#octokit.hook.wrap('request', ((request: Send, endpoint: Endpoint) =>
      this.#send(request, endpoint)) as never);
  }

  get rateLimit(): GitHubRateLimit | null {
    return this.#rateLimit;
  }

  verifyWebhook(): Promise<boolean> {
    return Promise.reject(
      new IntegrationNotConfiguredError(GITHUB_NOT_CONFIGURED, [...this.missingEnv]),
    );
  }

  /** No App, so no installation anywhere. */
  async getRepoInstallationId(): Promise<number | null> {
    return null;
  }

  getInstallationToken(): Promise<InstallationToken> {
    return readOnly();
  }

  async gitToken(): Promise<string | undefined> {
    return this.#token;
  }

  getRepository(fullName: string): Promise<RepositoryInfo | null> {
    return readRepository(this.#octokit, fullName);
  }

  getPullRequest(fullName: string, number: number): Promise<GitHubPullRequest> {
    return readPullRequest(this.#octokit, fullName, number);
  }

  listOpenPullRequests(fullName: string): Promise<OpenPullRequestSummary[]> {
    return readOpenPullRequests(this.#octokit, fullName);
  }

  postIssueComment(): Promise<{ id: number }> {
    return readOnly();
  }

  getCiStatus(fullName: string, sha: string): Promise<CiStatus> {
    return readCiStatus(this.#octokit, fullName, sha);
  }

  /** A personal token cannot list an organisation's repositories: connect one by name. */
  async listAccessibleRepositories(): Promise<AccessibleRepository[]> {
    return [];
  }

  compareCommits(fullName: string, base: string, head: string): Promise<CommitComparison> {
    return readComparison(this.#octokit, fullName, base, head);
  }

  getCommit(fullName: string, sha: string): Promise<GitHubCommit> {
    return readCommit(this.#octokit, fullName, sha);
  }

  getPullRequestState(fullName: string, number: number): Promise<PullRequestFreshState> {
    return readPullRequestState(this.#octokit, fullName, number);
  }

  listChangesRequested(fullName: string, number: number): Promise<string[]> {
    return readChangesRequested(this.#octokit, fullName, number);
  }

  listReviewComments(fullName: string, number: number): Promise<GitHubComment[]> {
    return readReviewComments(this.#octokit, fullName, number);
  }

  squashMerge(): Promise<MergeResult> {
    return readOnly();
  }

  getUser(login: string): Promise<GitHubUser | null> {
    return readUser(this.#octokit, login);
  }

  getBotIdentity(): Promise<{ name: string; email: string }> {
    return readOnly();
  }

  /**
   * Every request: refused while the limit is used up; a GET goes with the ETag of its last
   * answer, and a 304 (which costs no quota) gives that answer again. Each answer updates the
   * rate limit; a limit answer blocks every request until GitHub's reset.
   */
  async #send(request: Send, endpoint: Endpoint): Promise<Answer> {
    if (this.#blockedUntil > this.#now()) throw this.#limited();
    const method = String(endpoint.method ?? 'GET').toUpperCase();
    const key =
      method === 'GET' ? this.#octokit.request.endpoint.parse(endpoint as never).url : null;
    const cached = key ? this.#answers.get(key) : undefined;
    if (cached) endpoint.headers = { ...endpoint.headers, 'if-none-match': cached.etag };
    try {
      const response = await request(endpoint);
      this.#note(response.headers);
      const etag = response.headers.etag;
      if (key && typeof etag === 'string') this.#remember(key, { etag, response });
      return response;
    } catch (error) {
      const headers = (error as { response?: { headers?: Headers } }).response?.headers;
      if (headers) this.#note(headers);
      const status = statusOf(error);
      if (status === 304 && cached && key) {
        this.#remember(key, cached);
        return cached.response;
      }
      if ((status === 403 || status === 429) && headers && isLimitAnswer(headers)) {
        this.#blockedUntil = resetOf(headers, this.#now());
        throw this.#limited();
      }
      throw error;
    }
  }

  #note(headers: Headers): void {
    const limit = Number(headers['x-ratelimit-limit']);
    const remaining = Number(headers['x-ratelimit-remaining']);
    const reset = Number(headers['x-ratelimit-reset']);
    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) return;
    this.#rateLimit = { limit, remaining, resetAt: new Date(reset * 1000).toISOString() };
    // The next request would be refused: wait for the reset instead of asking.
    if (remaining <= 0) this.#blockedUntil = Math.max(this.#blockedUntil, reset * 1000);
  }

  #remember(key: string, answer: CachedAnswer): void {
    this.#answers.delete(key);
    this.#answers.set(key, answer);
    if (this.#answers.size > MAX_CACHED_ANSWERS) {
      this.#answers.delete(this.#answers.keys().next().value!);
    }
  }

  #limited(): IntegrationError {
    return new IntegrationError(GITHUB_RATE_LIMITED, {
      resetAt: new Date(this.#blockedUntil).toISOString(),
    });
  }
}

function readOnly(): Promise<never> {
  return Promise.reject(new IntegrationError(GITHUB_READ_ONLY));
}

/** A 403 or 429 that is GitHub's primary or secondary rate limit, not a permission. */
function isLimitAnswer(headers: Headers): boolean {
  return String(headers['x-ratelimit-remaining']) === '0' || headers['retry-after'] !== undefined;
}

/** When to ask again: `retry-after` seconds, else the limit's reset, else a minute. */
function resetOf(headers: Headers, now: number): number {
  const retryAfter = Number(headers['retry-after']);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return now + retryAfter * 1000;
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(reset) && reset * 1000 > now) return reset * 1000;
  return now + FALLBACK_BACKOFF_MS;
}
