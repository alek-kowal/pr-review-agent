import { readFileSync } from 'node:fs';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import { Webhooks } from '@octokit/webhooks';
import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import {
  changesRequestedBy,
  checkRunState,
  ciStatusOf,
  commitStatusState,
  GITHUB_APP_NOT_INSTALLED,
  GITHUB_ENV,
  GITHUB_NOT_CONFIGURED,
  MERGE_REFUSAL_STATUSES,
  splitFullName,
  toPullRequest,
  type AccessibleRepository,
  type CiCheck,
  type CiStatus,
  type CommitComparison,
  type GitHubComment,
  type GitHubCommit,
  type GitHubGateway,
  type GitHubPullRequest,
  type InstallationToken,
  type MergeResult,
  type PullRequestFreshState,
  type PullRequestReview,
  type RawPullRequest,
  type SquashMerge,
} from './github-gateway.ts';

/** GitHub's largest page; check runs are read for at most `MAX_PAGES` pages. */
const PER_PAGE = 100;
const MAX_PAGES = 10;

/** A token is replaced this long before GitHub's `expires_at`, so no call races the expiry. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type OctokitGitHubGatewayOptions = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  /** Clock for token expiry; tests move it forward. */
  now?: () => number;
};

/** `GitHubGateway` on `@octokit/app` (App JWT) and `@octokit/webhooks`, with installation tokens only. */
export class OctokitGitHubGateway implements GitHubGateway {
  readonly #app: App<{ Octokit: typeof Octokit }>;
  readonly #webhooks: Webhooks;
  readonly #now: () => number;
  readonly #tokens = new Map<number, Promise<InstallationToken>>();
  readonly #installations = new Map<string, number>();
  readonly missingEnv: readonly string[] = [];

  constructor(options: OctokitGitHubGatewayOptions) {
    this.#app = new App({ appId: options.appId, privateKey: options.privateKey, Octokit });
    this.#webhooks = new Webhooks({ secret: options.webhookSecret });
    this.#now = options.now ?? Date.now;
  }

  async verifyWebhook(rawBody: string | Uint8Array, signature: string | undefined) {
    if (!signature) return false;
    const payload = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
    try {
      return await this.#webhooks.verify(payload, signature);
    } catch {
      return false;
    }
  }

  async getRepoInstallationId(fullName: string): Promise<number | null> {
    try {
      const { data } = await this.#app.octokit.request('GET /repos/{owner}/{repo}/installation', {
        ...splitFullName(fullName),
      });
      this.#installations.set(fullName, data.id);
      return data.id;
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  getInstallationToken(installationId: number): Promise<InstallationToken> {
    const cached = this.#tokens.get(installationId);
    if (cached) {
      return cached.then((token) =>
        token.expiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS > this.#now()
          ? token
          : this.#newToken(installationId),
      );
    }
    return this.#newToken(installationId);
  }

  async getPullRequest(fullName: string, number: number): Promise<GitHubPullRequest> {
    return this.#withInstallation(fullName, async (octokit) => {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        ...splitFullName(fullName),
        pull_number: number,
      });
      return toPullRequest(data as RawPullRequest);
    });
  }

  async postIssueComment(fullName: string, number: number, body: string) {
    return this.#withInstallation(fullName, async (octokit) => {
      const { data } = await octokit.request(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
        { ...splitFullName(fullName), issue_number: number, body },
      );
      // GitHub's schema allows int64 ids; comment ids fit a JS number.
      return { id: Number(data.id) };
    });
  }

  async compareCommits(fullName: string, base: string, head: string): Promise<CommitComparison> {
    return this.#withInstallation(fullName, async (octokit) => {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
        ...splitFullName(fullName),
        basehead: `${base}...${head}`,
        // Only the counts are read; one commit per page keeps the response small.
        per_page: 1,
      });
      return { status: data.status, aheadBy: data.ahead_by, behindBy: data.behind_by };
    });
  }

  async getCiStatus(fullName: string, sha: string): Promise<CiStatus> {
    return this.#withInstallation(fullName, async (octokit) => {
      const repo = splitFullName(fullName);
      const checks: CiCheck[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data } = await octokit.request(
          'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
          {
            ...repo,
            ref: sha,
            per_page: PER_PAGE,
            page,
          },
        );
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
        checks.push({
          name: status.context,
          source: 'status',
          state: commitStatusState(status.state),
        });
      }
      return ciStatusOf(checks);
    });
  }

  async getCommit(fullName: string, sha: string): Promise<GitHubCommit> {
    return this.#withInstallation(fullName, async (octokit) => {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
        ...splitFullName(fullName),
        ref: sha,
      });
      return {
        sha: data.sha,
        parents: data.parents.map((parent) => parent.sha),
        message: data.commit.message,
      };
    });
  }

  async getPullRequestState(fullName: string, number: number): Promise<PullRequestFreshState> {
    return this.#withInstallation(fullName, async (octokit) => {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        ...splitFullName(fullName),
        pull_number: number,
      });
      const pr = toPullRequest(data as RawPullRequest);
      return { headSha: pr.headSha, state: pr.state, mergeableState: data.mergeable_state };
    });
  }

  async listChangesRequested(fullName: string, number: number): Promise<string[]> {
    return this.#withInstallation(fullName, async (octokit) => {
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
    });
  }

  async listReviewComments(fullName: string, number: number): Promise<GitHubComment[]> {
    return this.#withInstallation(fullName, async (octokit) => {
      const repo = splitFullName(fullName);
      const comments: GitHubComment[] = [];
      type User = { login: string; type?: string } | null;
      const add = (
        kind: string,
        item: {
          id: number | bigint;
          user: User;
          body?: string | null;
          created_at?: string | null;
        },
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
    });
  }

  async squashMerge(merge: SquashMerge): Promise<MergeResult> {
    return this.#withInstallation(merge.fullName, async (octokit) => {
      try {
        const { data } = await octokit.request(
          'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
          {
            ...splitFullName(merge.fullName),
            pull_number: merge.number,
            sha: merge.sha,
            merge_method: 'squash',
            commit_title: merge.title,
            commit_message: merge.message,
          },
        );
        return { merged: true, sha: data.sha };
      } catch (error) {
        const status = statusOf(error);
        if (status === undefined || !MERGE_REFUSAL_STATUSES.has(status)) throw error;
        return { merged: false, status, message: githubMessage(error) };
      }
    });
  }

  async listAccessibleRepositories(): Promise<AccessibleRepository[]> {
    const repositories: AccessibleRepository[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data: installations } = await this.#app.octokit.request('GET /app/installations', {
        per_page: PER_PAGE,
        page,
      });
      for (const installation of installations) {
        const account = accountName(installation.account);
        const { token } = await this.getInstallationToken(installation.id);
        const octokit = new Octokit({ auth: token });
        for (let repoPage = 1; repoPage <= MAX_PAGES; repoPage++) {
          const { data } = await octokit.request('GET /installation/repositories', {
            per_page: PER_PAGE,
            page: repoPage,
          });
          for (const repo of data.repositories) {
            this.#installations.set(repo.full_name, installation.id);
            repositories.push({
              fullName: repo.full_name,
              installationId: installation.id,
              account,
              defaultBranch: repo.default_branch,
              private: repo.private,
            });
          }
          if (data.repositories.length < PER_PAGE) break;
        }
      }
      if (installations.length < PER_PAGE) break;
    }
    return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * Runs `call` with the repository's installation client. A cached installation goes stale when
   * the App is reinstalled (new id, old tokens revoked) or the repository leaves it; GitHub then
   * answers 401 or 404. So on those, once, the cached id and its token are dropped and the call
   * runs again on a fresh lookup (a 401 or 404 means nothing was written, so a retry is safe).
   */
  async #withInstallation<T>(fullName: string, call: (octokit: Octokit) => Promise<T>): Promise<T> {
    const cachedId = this.#installations.get(fullName);
    try {
      return await call(await this.#installationOctokit(fullName));
    } catch (error) {
      const status = statusOf(error);
      if (cachedId === undefined || (status !== 401 && status !== 404)) throw error;
      this.#installations.delete(fullName);
      this.#tokens.delete(cachedId);
      return call(await this.#installationOctokit(fullName));
    }
  }

  #newToken(installationId: number): Promise<InstallationToken> {
    const pending = this.#requestToken(installationId);
    this.#tokens.set(installationId, pending);
    // A failed request is not cached; the next call asks again.
    pending.catch(() => {
      if (this.#tokens.get(installationId) === pending) this.#tokens.delete(installationId);
    });
    return pending;
  }

  async #requestToken(installationId: number): Promise<InstallationToken> {
    // `refresh` skips @octokit/auth-app's own cache; this class decides when a token is reused.
    const auth = (await this.#app.octokit.auth({
      type: 'installation',
      installationId,
      refresh: true,
    })) as { token: string; expiresAt: string };
    return { token: auth.token, expiresAt: new Date(auth.expiresAt) };
  }

  async #installationOctokit(fullName: string): Promise<Octokit> {
    const installationId =
      this.#installations.get(fullName) ?? (await this.getRepoInstallationId(fullName));
    if (installationId === null) throw new IntegrationError(GITHUB_APP_NOT_INSTALLED, { fullName });
    const { token } = await this.getInstallationToken(installationId);
    return new Octokit({ auth: token });
  }
}

/** Every call throws `github_not_configured` before touching the network. */
export class UnconfiguredGitHubGateway implements GitHubGateway {
  readonly missing: string[];

  constructor(missing: string[]) {
    this.missing = missing;
  }

  get missingEnv(): readonly string[] {
    return this.missing;
  }
  verifyWebhook(): Promise<boolean> {
    return this.#fail();
  }
  getRepoInstallationId(): Promise<number | null> {
    return this.#fail();
  }
  getInstallationToken(): Promise<InstallationToken> {
    return this.#fail();
  }
  getPullRequest(): Promise<GitHubPullRequest> {
    return this.#fail();
  }
  postIssueComment(): Promise<{ id: number }> {
    return this.#fail();
  }
  getCiStatus(): Promise<CiStatus> {
    return this.#fail();
  }
  compareCommits(): Promise<CommitComparison> {
    return this.#fail();
  }
  listAccessibleRepositories(): Promise<AccessibleRepository[]> {
    return this.#fail();
  }
  getCommit(): Promise<GitHubCommit> {
    return this.#fail();
  }
  getPullRequestState(): Promise<PullRequestFreshState> {
    return this.#fail();
  }
  listChangesRequested(): Promise<string[]> {
    return this.#fail();
  }
  listReviewComments(): Promise<GitHubComment[]> {
    return this.#fail();
  }
  squashMerge(): Promise<MergeResult> {
    return this.#fail();
  }

  #fail(): Promise<never> {
    return Promise.reject(new IntegrationNotConfiguredError(GITHUB_NOT_CONFIGURED, this.missing));
  }
}

/**
 * The gateway for `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` and `GITHUB_WEBHOOK_SECRET`.
 * A missing variable, or a key file that is missing or empty, gives the unconfigured gateway.
 */
export function createGitHubGateway(
  env: NodeJS.ProcessEnv = process.env,
  options: Pick<OctokitGitHubGatewayOptions, 'now'> = {},
): GitHubGateway {
  const missing: string[] = GITHUB_ENV.filter((name) => !env[name]);
  let privateKey = '';
  if (env.GITHUB_APP_PRIVATE_KEY_PATH) {
    privateKey = readKey(env.GITHUB_APP_PRIVATE_KEY_PATH);
    if (!privateKey) missing.push('GITHUB_APP_PRIVATE_KEY_PATH');
  }
  if (missing.length > 0) return new UnconfiguredGitHubGateway(missing);
  return new OctokitGitHubGateway({
    appId: env.GITHUB_APP_ID!,
    privateKey,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET!,
    ...options,
  });
}

function readKey(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

/** An installation's account: a user or organization login, or an enterprise slug. */
function accountName(account: unknown): string {
  const { login, slug } = (account ?? {}) as { login?: unknown; slug?: unknown };
  return typeof login === 'string' ? login : typeof slug === 'string' ? slug : '';
}

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/** GitHub's own `message` from an error answer, kept verbatim. */
function githubMessage(error: unknown): string {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  const message = (data as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string') return message;
  return error instanceof Error ? error.message : String(error);
}
