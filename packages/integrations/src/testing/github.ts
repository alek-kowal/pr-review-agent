import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GitHubMode } from '@pra/core';
import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import {
  changesRequestedBy,
  ciStatusOf,
  GITHUB_APP_NOT_INSTALLED,
  GITHUB_ENV,
  GITHUB_NOT_CONFIGURED,
  GITHUB_READ_ONLY,
  toPullRequest,
  type GitHubRateLimit,
  type RepositoryInfo,
  type AccessibleRepository,
  type CiCheck,
  type CommitComparison,
  type CiStatus,
  type GitHubComment,
  type GitHubGateway,
  type GitHubCommit,
  type GitHubPullRequest,
  type GitHubUser,
  type InstallationToken,
  type MergeResult,
  type OpenPullRequestSummary,
  type PullRequestFreshState,
  type PullRequestReview,
  type RawPullRequest,
  type SquashMerge,
} from '../github/index.ts';

/** The bot the fake App commits as. */
export const FAKE_BOT = {
  name: 'pr-review-agent[bot]',
  email: '41898282+pr-review-agent[bot]@users.noreply.github.com',
} as const;

/** The `X-Hub-Signature-256` value GitHub sends for `body` signed with `secret`. */
export function signWebhook(body: string | Uint8Array, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export const GITHUB_FIXTURES = [
  'ping',
  'pull_request.opened',
  'pull_request.opened-draft',
  'pull_request.opened-fork',
  'pull_request.ready_for_review',
  'pull_request.synchronize',
  'pull_request.closed',
  'pull_request.reopened',
  'check_suite.completed',
  'status',
  'pull_request_review.submitted',
] as const;
export type GitHubFixtureName = (typeof GITHUB_FIXTURES)[number];
/** The fixtures of `pull_request` deliveries, which carry a PR snapshot. */
export type PullRequestFixtureName = Extract<GitHubFixtureName, `pull_request.${string}`>;

export type GitHubFixture = {
  /** The `X-GitHub-Event` header value: the fixture name up to the first dot. */
  event: string;
  /** The raw body, as GitHub sends it (sign this, not a re-serialised payload). */
  body: string;
  payload: Record<string, unknown>;
};

/**
 * A trimmed webhook delivery from `fixtures/github/` (WB-like values: `synergycodes/workflowbuilder`,
 * PR 312, installation 55500001; the fork variant is PR 313 from `outside-dev/workflowbuilder`).
 */
export function githubFixture(name: GitHubFixtureName): GitHubFixture {
  const body = readFileSync(new URL(`./fixtures/github/${name}.json`, import.meta.url), 'utf8');
  const event = name.split('.')[0]!;
  return { event, body, payload: JSON.parse(body) as Record<string, unknown> };
}

/** The PR snapshot inside a `pull_request` fixture. */
export function fixturePullRequest(name: PullRequestFixtureName): GitHubPullRequest {
  return toPullRequest(githubFixture(name).payload.pull_request as RawPullRequest);
}

type Method = keyof GitHubGateway;
export type GitHubCall = { method: Method; args: unknown[] };

/** The personal token the double hands to git in token mode. */
export const FAKE_PERSONAL_TOKEN = 'fake-personal-token';

/**
 * In-memory `GitHubGateway` for tests. It records every call, verifies signatures with a real
 * HMAC over its `webhookSecret`, serves the PRs and installations it was given, and fails a
 * method once when told to. It acts as the App until `setMode` says `token` or `anonymous`; then,
 * like `TokenGitHubGateway`, every write throws `github_read_only` and webhooks are not
 * configured.
 */
export class FakeGitHubGateway implements GitHubGateway {
  readonly webhookSecret: string;
  readonly calls: GitHubCall[] = [];
  readonly comments: Array<{ fullName: string; number: number; body: string; id: number }> = [];
  readonly installations = new Map<string, number>();
  /** What the last answer said about the rate limit; tests set it. */
  rateLimit: GitHubRateLimit | null = null;
  #mode: GitHubMode = 'app';
  /** Default branch and visibility per repository, for `listAccessibleRepositories`. */
  readonly repositoryDetails = new Map<string, Partial<AccessibleRepository>>();
  readonly pullRequests = new Map<string, GitHubPullRequest>();
  /** Commits by `owner/name@sha`; an unknown commit has one parent and no message. */
  readonly commits = new Map<string, GitHubCommit>();
  /** CI checks by `owner/name@sha`; a commit without an entry has no checks. */
  readonly ci = new Map<string, CiCheck[]>();
  /** Compares by `owner/name:base...head`; a pair without an entry is a 404 unless equal. */
  readonly comparisons = new Map<string, CommitComparison>();
  /** Reviews by `owner/name#number`, oldest first. */
  readonly reviews = new Map<string, PullRequestReview[]>();
  /** People's comments by `owner/name#number`, oldest first (`addComment`). */
  readonly prComments = new Map<string, GitHubComment[]>();
  /** Merges GitHub refuses, by `owner/name#number`. */
  readonly mergeRefusals = new Map<string, { status: number; message: string }>();
  /** Every squash merge that went through. */
  readonly merges: Array<SquashMerge & { mergeSha: string }> = [];
  /** GitHub accounts by lower-case login (`addUser`). */
  readonly users = new Map<string, GitHubUser>();
  readonly #failures = new Map<Method, Error[]>();
  #nextId = 1;

  constructor(options: { webhookSecret?: string; installations?: Record<string, number> } = {}) {
    this.webhookSecret = options.webhookSecret ?? 'test-webhook-secret';
    for (const [fullName, id] of Object.entries(options.installations ?? {})) {
      this.installations.set(fullName, id);
    }
  }

  get mode(): GitHubMode {
    return this.#mode;
  }

  setMode(mode: GitHubMode): this {
    this.#mode = mode;
    return this;
  }

  /** Without the App, its three env vars are what is missing. */
  get missingEnv(): readonly string[] {
    return this.mode === 'app' ? [] : [...GITHUB_ENV];
  }

  addPullRequest(pr: GitHubPullRequest): this {
    this.pullRequests.set(`${pr.fullName}#${pr.number}`, pr);
    return this;
  }

  /** Removes a PR, as if GitHub no longer listed it. */
  removePullRequest(fullName: string, number: number): this {
    this.pullRequests.delete(`${fullName}#${number}`);
    return this;
  }

  /** A repository is known when it has an installation, details or a PR. */
  async getRepository(fullName: string): Promise<RepositoryInfo | null> {
    this.#record('getRepository', [fullName]);
    const known =
      this.installations.has(fullName) ||
      this.repositoryDetails.has(fullName) ||
      [...this.pullRequests.values()].some((pr) => pr.fullName === fullName);
    if (!known) return null;
    const details = this.repositoryDetails.get(fullName);
    return {
      fullName,
      defaultBranch: details?.defaultBranch ?? 'main',
      private: details?.private ?? false,
    };
  }

  async gitToken(installationId: number | null): Promise<string | undefined> {
    this.#record('gitToken', [installationId]);
    if (this.mode === 'token') return FAKE_PERSONAL_TOKEN;
    if (this.mode === 'anonymous' || !installationId) return undefined;
    return `fake-token-${installationId}`;
  }

  addCommit(fullName: string, commit: GitHubCommit): this {
    this.commits.set(`${fullName}@${commit.sha}`, commit);
    return this;
  }

  setCiChecks(fullName: string, sha: string, checks: CiCheck[]): this {
    this.ci.set(`${fullName}@${sha}`, checks);
    return this;
  }

  /** `head` is `aheadBy` commits ahead of `base` (and `behindBy` behind it). */
  setComparison(fullName: string, base: string, head: string, aheadBy: number, behindBy = 0): this {
    const status =
      aheadBy && behindBy ? 'diverged' : aheadBy ? 'ahead' : behindBy ? 'behind' : 'identical';
    this.comparisons.set(`${fullName}:${base}...${head}`, { status, aheadBy, behindBy });
    return this;
  }

  /** A review by `login` (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`). */
  addReview(fullName: string, number: number, login: string, state: string): this {
    const key = `${fullName}#${number}`;
    this.reviews.set(key, [...(this.reviews.get(key) ?? []), { login, state }]);
    return this;
  }

  /** GitHub refuses every merge of this PR with `status` and `message`. */
  refuseMerge(fullName: string, number: number, refusal: { status: number; message: string }) {
    this.mergeRefusals.set(`${fullName}#${number}`, refusal);
    return this;
  }

  /** The next call of `method` rejects with `error`. */
  failNext(method: Method, error: Error): this {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), error]);
    return this;
  }

  callsOf(method: Method): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  async verifyWebhook(rawBody: string | Uint8Array, signature: string | undefined) {
    this.#record('verifyWebhook', [rawBody, signature]);
    if (this.mode !== 'app') {
      throw new IntegrationNotConfiguredError(GITHUB_NOT_CONFIGURED, [...GITHUB_ENV]);
    }
    if (!signature) return false;
    const expected = Buffer.from(signWebhook(rawBody, this.webhookSecret));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async getRepoInstallationId(fullName: string) {
    this.#record('getRepoInstallationId', [fullName]);
    return this.installations.get(fullName) ?? null;
  }

  async getInstallationToken(installationId: number): Promise<InstallationToken> {
    this.#record('getInstallationToken', [installationId]);
    this.#refuseWrite();
    return { token: `fake-token-${installationId}`, expiresAt: new Date(Date.now() + 3_600_000) };
  }

  async getPullRequest(fullName: string, number: number) {
    this.#record('getPullRequest', [fullName, number]);
    const pr = this.pullRequests.get(`${fullName}#${number}`);
    if (!pr) throw Object.assign(new Error(`Not Found: ${fullName}#${number}`), { status: 404 });
    return pr;
  }

  async listOpenPullRequests(fullName: string): Promise<OpenPullRequestSummary[]> {
    this.#record('listOpenPullRequests', [fullName]);
    return [...this.pullRequests.values()]
      .filter((pr) => pr.fullName === fullName && pr.state === 'open')
      .sort((a, b) => a.number - b.number)
      .map((pr) => ({
        number: pr.number,
        headSha: pr.headSha,
        isDraft: pr.isDraft,
        updatedAt: pr.updatedAt,
        // The list has no commit counts.
        snapshot: { ...pr, commitsCount: 0 },
      }));
  }

  async compareCommits(fullName: string, base: string, head: string): Promise<CommitComparison> {
    this.#record('compareCommits', [fullName, base, head]);
    const known = this.comparisons.get(`${fullName}:${base}...${head}`);
    if (known) return known;
    if (base === head) return { status: 'identical', aheadBy: 0, behindBy: 0 };
    throw Object.assign(new Error(`Not Found: ${base}...${head}`), { status: 404 });
  }

  async postIssueComment(fullName: string, number: number, body: string) {
    this.#record('postIssueComment', [fullName, number, body]);
    this.#refuseWrite();
    if (!this.installations.has(fullName)) {
      throw new IntegrationError(GITHUB_APP_NOT_INSTALLED, { fullName });
    }
    const id = this.#nextId++;
    this.comments.push({ fullName, number, body, id });
    return { id };
  }

  async getCiStatus(fullName: string, sha: string): Promise<CiStatus> {
    this.#record('getCiStatus', [fullName, sha]);
    return ciStatusOf(this.ci.get(`${fullName}@${sha}`) ?? []);
  }

  async getCommit(fullName: string, sha: string): Promise<GitHubCommit> {
    this.#record('getCommit', [fullName, sha]);
    return (
      this.commits.get(`${fullName}@${sha}`) ?? { sha, parents: ['0'.repeat(40)], message: '' }
    );
  }

  /** The PR it was given (404 otherwise), mergeable `clean` while open. */
  async getPullRequestState(fullName: string, number: number): Promise<PullRequestFreshState> {
    this.#record('getPullRequestState', [fullName, number]);
    const pr = this.pullRequests.get(`${fullName}#${number}`);
    if (!pr) throw Object.assign(new Error(`Not Found: ${fullName}#${number}`), { status: 404 });
    return {
      headSha: pr.headSha,
      state: pr.state,
      mergeableState: pr.state === 'open' ? 'clean' : 'unknown',
    };
  }

  async listChangesRequested(fullName: string, number: number): Promise<string[]> {
    this.#record('listChangesRequested', [fullName, number]);
    return changesRequestedBy(this.reviews.get(`${fullName}#${number}`) ?? []);
  }

  /** A comment by `login` on the PR (a line comment when `place` names a path). */
  addComment(
    fullName: string,
    number: number,
    login: string,
    body: string,
    place: { path?: string; line?: number } = {},
  ): this {
    const key = `${fullName}#${number}`;
    const id = this.#nextId++;
    this.prComments.set(key, [
      ...(this.prComments.get(key) ?? []),
      {
        id: `${place.path ? 'review_comment' : 'issue_comment'}:${id}`,
        author: login,
        body,
        path: place.path ?? null,
        line: place.line ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
      },
    ]);
    return this;
  }

  async listReviewComments(fullName: string, number: number): Promise<GitHubComment[]> {
    this.#record('listReviewComments', [fullName, number]);
    return [...(this.prComments.get(`${fullName}#${number}`) ?? [])];
  }

  /**
   * Refuses as told by `refuseMerge`, or with GitHub's 409 when a known PR's head is not `sha`;
   * otherwise records the merge and marks a known PR merged.
   */
  async squashMerge(merge: SquashMerge): Promise<MergeResult> {
    this.#record('squashMerge', [merge]);
    this.#refuseWrite();
    const key = `${merge.fullName}#${merge.number}`;
    const refusal = this.mergeRefusals.get(key);
    if (refusal) return { merged: false, ...refusal };
    const pr = this.pullRequests.get(key);
    if (pr && pr.headSha !== merge.sha) {
      return {
        merged: false,
        status: 409,
        message: 'Head branch was modified. Review and try the merge again.',
      };
    }
    const mergeSha = createHash('sha1').update(`merge:${key}:${merge.sha}`).digest('hex');
    this.merges.push({ ...merge, mergeSha });
    if (pr) {
      const now = new Date().toISOString();
      this.pullRequests.set(key, {
        ...pr,
        state: 'merged',
        closedAt: now,
        mergedAt: now,
        mergeSha,
      });
    }
    return { merged: true, sha: mergeSha };
  }

  /** Every repository in `installations`, with `repositoryDetails` over the defaults. */
  async listAccessibleRepositories(): Promise<AccessibleRepository[]> {
    this.#record('listAccessibleRepositories', []);
    // A personal token lists nothing: repositories are connected by name.
    if (this.mode !== 'app') return [];
    return [...this.installations]
      .map(([fullName, installationId]) => ({
        fullName,
        installationId,
        account: fullName.split('/')[0]!,
        defaultBranch: 'main',
        private: false,
        ...this.repositoryDetails.get(fullName),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /** A GitHub account `getUser` knows; any other login is unknown. */
  addUser(login: string, id: number): this {
    this.users.set(login.toLowerCase(), { id, login });
    return this;
  }

  async getUser(login: string): Promise<GitHubUser | null> {
    this.#record('getUser', [login]);
    return this.users.get(login.toLowerCase()) ?? null;
  }

  async getBotIdentity(): Promise<{ name: string; email: string }> {
    this.#record('getBotIdentity', []);
    this.#refuseWrite();
    return { ...FAKE_BOT };
  }

  /** Token and anonymous mode never write to GitHub. */
  #refuseWrite(): void {
    if (this.mode !== 'app') throw new IntegrationError(GITHUB_READ_ONLY);
  }

  #record(method: Method, args: unknown[]): void {
    this.calls.push({ method, args });
    const failure = this.#failures.get(method)?.shift();
    if (failure) throw failure;
  }
}
