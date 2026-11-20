import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import { Webhooks } from '@octokit/webhooks';
import { IntegrationError } from '../errors.ts';
import { noreplyEmail } from '../git-mirror.ts';
import {
  GITHUB_APP_NOT_INSTALLED,
  MERGE_REFUSAL_STATUSES,
  splitFullName,
  type AccessibleRepository,
  type CiStatus,
  type CommitComparison,
  type GitHubComment,
  type GitHubCommit,
  type GitHubGateway,
  type GitHubPullRequest,
  type GitHubUser,
  type InstallationToken,
  type MergeResult,
  type OpenPullRequestSummary,
  type PullRequestFreshState,
  type RepositoryInfo,
  type SquashMerge,
} from './github-gateway.ts';
import {
  MAX_PAGES,
  PER_PAGE,
  readChangesRequested,
  readCiStatus,
  readComparison,
  readCommit,
  readOpenPullRequests,
  readPullRequest,
  readPullRequestState,
  readReviewComments,
  readUser,
  statusOf,
} from './github-reads.ts';

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
  readonly mode = 'app' as const;
  readonly rateLimit = null;
  readonly #app: App<{ Octokit: typeof Octokit }>;
  readonly #webhooks: Webhooks;
  readonly #now: () => number;
  readonly #tokens = new Map<number, Promise<InstallationToken>>();
  readonly #installations = new Map<string, number>();
  #bot: Promise<{ name: string; email: string }> | undefined;
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

  async gitToken(installationId: number | null): Promise<string | undefined> {
    return installationId ? (await this.getInstallationToken(installationId)).token : undefined;
  }

  async getRepository(fullName: string): Promise<RepositoryInfo | null> {
    const found = (await this.listAccessibleRepositories()).find(
      (r) => r.fullName.toLowerCase() === fullName.toLowerCase(),
    );
    return found
      ? { fullName: found.fullName, defaultBranch: found.defaultBranch, private: found.private }
      : null;
  }

  getPullRequest(fullName: string, number: number): Promise<GitHubPullRequest> {
    return this.#withInstallation(fullName, (o) => readPullRequest(o, fullName, number));
  }

  listOpenPullRequests(fullName: string): Promise<OpenPullRequestSummary[]> {
    return this.#withInstallation(fullName, (o) => readOpenPullRequests(o, fullName));
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

  compareCommits(fullName: string, base: string, head: string): Promise<CommitComparison> {
    return this.#withInstallation(fullName, (o) => readComparison(o, fullName, base, head));
  }

  getCiStatus(fullName: string, sha: string): Promise<CiStatus> {
    return this.#withInstallation(fullName, (o) => readCiStatus(o, fullName, sha));
  }

  getCommit(fullName: string, sha: string): Promise<GitHubCommit> {
    return this.#withInstallation(fullName, (o) => readCommit(o, fullName, sha));
  }

  getPullRequestState(fullName: string, number: number): Promise<PullRequestFreshState> {
    return this.#withInstallation(fullName, (o) => readPullRequestState(o, fullName, number));
  }

  listChangesRequested(fullName: string, number: number): Promise<string[]> {
    return this.#withInstallation(fullName, (o) => readChangesRequested(o, fullName, number));
  }

  listReviewComments(fullName: string, number: number): Promise<GitHubComment[]> {
    return this.#withInstallation(fullName, (o) => readReviewComments(o, fullName, number));
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

  getUser(login: string): Promise<GitHubUser | null> {
    return readUser(this.#app.octokit, login);
  }

  async getBotIdentity(): Promise<{ name: string; email: string }> {
    this.#bot ??= (async () => {
      const { data: app } = await this.#app.octokit.request('GET /app');
      const login = `${app?.slug ?? ''}[bot]`;
      const user = await this.getUser(login);
      if (!user) throw new Error(`GitHub has no bot account ${login}`);
      return { name: login, email: noreplyEmail(user.id, login) };
    })().catch((error: unknown) => {
      this.#bot = undefined;
      throw error;
    });
    return this.#bot;
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

/** An installation's account: a user or organization login, or an enterprise slug. */
function accountName(account: unknown): string {
  const { login, slug } = (account ?? {}) as { login?: unknown; slug?: unknown };
  return typeof login === 'string' ? login : typeof slug === 'string' ? slug : '';
}

/** GitHub's own `message` from an error answer, kept verbatim. */
function githubMessage(error: unknown): string {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  const message = (data as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string') return message;
  return error instanceof Error ? error.message : String(error);
}
