import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IntegrationError } from '../errors.ts';
import {
  ciStatusOf,
  GITHUB_APP_NOT_INSTALLED,
  toPullRequest,
  type AccessibleRepository,
  type CiCheck,
  type CommitComparison,
  type CiStatus,
  type GitHubGateway,
  type GitHubCommit,
  type GitHubPullRequest,
  type InstallationToken,
  type OpenPullRequestSummary,
  type RawPullRequest,
} from '../github/index.ts';

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
] as const;
export type GitHubFixtureName = (typeof GITHUB_FIXTURES)[number];

export type GitHubFixture = {
  /** The `X-GitHub-Event` header value. */
  event: 'ping' | 'pull_request';
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
  const event = name === 'ping' ? 'ping' : 'pull_request';
  return { event, body, payload: JSON.parse(body) as Record<string, unknown> };
}

/** The PR snapshot inside a `pull_request` fixture. */
export function fixturePullRequest(name: Exclude<GitHubFixtureName, 'ping'>): GitHubPullRequest {
  return toPullRequest(githubFixture(name).payload.pull_request as RawPullRequest);
}

type Method = keyof GitHubGateway;
export type GitHubCall = { method: Method; args: unknown[] };

/**
 * In-memory `GitHubGateway` for tests. It records every call, verifies signatures with a real
 * HMAC over its `webhookSecret`, serves the PRs and installations it was given, and fails a
 * method once when told to.
 */
export class FakeGitHubGateway implements GitHubGateway {
  readonly webhookSecret: string;
  readonly calls: GitHubCall[] = [];
  readonly comments: Array<{ fullName: string; number: number; body: string; id: number }> = [];
  readonly installations = new Map<string, number>();
  readonly missingEnv: readonly string[] = [];
  /** Default branch and visibility per repository, for `listAccessibleRepositories`. */
  readonly repositoryDetails = new Map<string, Partial<AccessibleRepository>>();
  readonly pullRequests = new Map<string, GitHubPullRequest>();
  /** Commits by `owner/name@sha`; an unknown commit has one parent and no message. */
  readonly commits = new Map<string, GitHubCommit>();
  /** CI checks by `owner/name@sha`; a commit without an entry has no checks. */
  readonly ci = new Map<string, CiCheck[]>();
  /** Compares by `owner/name:base...head`; a pair without an entry is a 404 unless equal. */
  readonly comparisons = new Map<string, CommitComparison>();
  readonly #failures = new Map<Method, Error[]>();
  #nextId = 1;

  constructor(options: { webhookSecret?: string; installations?: Record<string, number> } = {}) {
    this.webhookSecret = options.webhookSecret ?? 'test-webhook-secret';
    for (const [fullName, id] of Object.entries(options.installations ?? {})) {
      this.installations.set(fullName, id);
    }
  }

  addPullRequest(pr: GitHubPullRequest): this {
    this.pullRequests.set(`${pr.fullName}#${pr.number}`, pr);
    return this;
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
      .map(({ number, headSha, isDraft, updatedAt }) => ({ number, headSha, isDraft, updatedAt }));
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

  /** Every repository in `installations`, with `repositoryDetails` over the defaults. */
  async listAccessibleRepositories(): Promise<AccessibleRepository[]> {
    this.#record('listAccessibleRepositories', []);
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

  #record(method: Method, args: unknown[]): void {
    this.calls.push({ method, args });
    const failure = this.#failures.get(method)?.shift();
    if (failure) throw failure;
  }
}
