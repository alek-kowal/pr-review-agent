// P-28: the GitHub poller, until the GitHub App exists. A pg-boss cron tick every minute; the
// schedule in Settings → Integrations decides which tick polls. Per connected repository it lists
// the open PRs (an ETag makes an unchanged list free) and turns each change since the last poll
// into the `pull_request` delivery a webhook would have brought, through the webhook's own path
// (`ingestGithubEvents` → `github.event` job → `handlePullRequestEvent`). The first poll of a
// repository is its baseline: it imports the open PRs and starts nothing.
import {
  githubPolls,
  pollDue,
  pollTransitions,
  POLL_BASELINE_STALE_MS,
  type PolledAction,
} from '@pra/core';
import {
  acquirePollLease,
  advanceSeenPullRequest,
  finishPoll,
  getAppSettings,
  getGithubPoller,
  getPollRepository,
  ingestGithubEvents,
  listRepositories,
  markRepositoryPolled,
  openPrNumbersWithActiveRun,
  seenPullRequests,
  storeSeenPullRequest,
  type GithubDelivery,
  type PollReason,
  type Repository,
  type SeenPullRequest,
} from '@pra/db';
import {
  GITHUB_RATE_LIMITED,
  IntegrationError,
  toRawPullRequest,
  type GitHubPullRequest,
} from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import { correctCi, reconcileRepository, type ReconcileResult } from './reconcile.ts';

/** A poll that runs longer than this is taken as dead; the next tick may start again. */
export const POLL_LEASE_MS = 10 * 60_000;

export type PollOutcome =
  /** App mode: webhooks bring the events. */
  | { status: 'off' }
  /** GitHub's rate limit is used up until `until`. */
  | { status: 'backoff'; until: Date }
  /** Outside the schedule, or the interval has not passed. */
  | { status: 'not_due' }
  /** Another poll holds the lease. */
  | { status: 'busy' }
  | {
      status: 'polled';
      /** Repositories baselined this poll. */
      baselined: string[];
      /** Deliveries recorded, as their ids. */
      delivered: string[];
      corrected: string[];
      failed: string[];
      /** Set when GitHub's rate limit stopped the poll. */
      rateLimitedUntil: Date | null;
    };

class RateLimited extends Error {
  readonly until: Date;
  constructor(until: Date) {
    super(`rate limited until ${until.toISOString()}`);
    this.until = until;
  }
}

export async function handleGithubPoll(
  deps: WorkerDeps,
  options: { force?: boolean; now?: Date } = {},
): Promise<PollOutcome> {
  const outcome = await pollGithub(deps, options);
  if (outcome.status === 'polled') {
    const { baselined, delivered, failed, rateLimitedUntil } = outcome;
    if (baselined.length || delivered.length || failed.length || rateLimitedUntil) {
      deps.logger.info(
        { baselined, delivered: delivered.length, failed, rateLimitedUntil },
        'github poll',
      );
    }
  }
  return outcome;
}

export async function pollGithub(
  deps: WorkerDeps,
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {},
): Promise<PollOutcome> {
  const { db, github } = deps;
  if (!githubPolls(github.mode)) return { status: 'off' };
  const poller = await getGithubPoller(db);
  // Poll now skips the window, never the backoff: a request now would only fail again.
  if (poller.backoffUntil && poller.backoffUntil > now) {
    return { status: 'backoff', until: poller.backoffUntil };
  }
  const schedule = (await getAppSettings(db)).value.githubPoll;
  if (!force && !pollDue(schedule, now, poller.lastStartedAt)) return { status: 'not_due' };
  if (!(await acquirePollLease(db, { now, leaseMs: POLL_LEASE_MS }))) return { status: 'busy' };

  const result: ReconcileResult = { corrected: [], failed: [] };
  const baselined: string[] = [];
  const delivered: string[] = [];
  let rateLimitedUntil: Date | null = null;
  try {
    for (const repository of await listRepositories(db)) {
      try {
        const polled = await getPollRepository(db, repository.id);
        const baseline =
          !polled || now.getTime() - polled.lastPolledAt.getTime() > POLL_BASELINE_STALE_MS;
        if (baseline) {
          await baselineRepository(deps, repository, result);
          baselined.push(repository.githubFullName);
        } else {
          delivered.push(...(await pollRepository(deps, repository, result)));
        }
        // CI moves without a head change; only PRs under review need it (each read costs quota).
        const underReview = await openPrNumbersWithActiveRun(db, repository.id);
        if (underReview.length) await correctCi(deps, repository, underReview, result);
        await markRepositoryPolled(db, repository.id, { at: now, baseline });
        checkRateLimit(deps, now);
      } catch (error) {
        if (error instanceof RateLimited) throw error;
        const until = rateLimitedAt(error);
        if (until) throw new RateLimited(until);
        deps.logger.warn(
          { err: error, repository: repository.githubFullName },
          'github poll: repository not polled',
        );
        result.failed.push(repository.githubFullName);
      }
    }
  } catch (error) {
    if (!(error instanceof RateLimited)) throw error;
    rateLimitedUntil = error.until;
  } finally {
    const error: PollReason | null = rateLimitedUntil
      ? { code: GITHUB_RATE_LIMITED, params: { resetAt: rateLimitedUntil.toISOString() } }
      : result.failed.length
        ? { code: 'github_poll_failed', params: { items: result.failed } }
        : null;
    await finishPoll(db, {
      finishedAt: new Date(),
      error,
      backoffUntil: rateLimitedUntil,
      rateLimit: github.rateLimit,
    });
  }
  return {
    status: 'polled',
    baselined,
    delivered,
    corrected: result.corrected,
    failed: result.failed,
    rateLimitedUntil,
  };
}

/** `resetAt` of a `github_rate_limited` error; null for any other error. */
function rateLimitedAt(error: unknown): Date | null {
  if (!(error instanceof IntegrationError) || error.code !== GITHUB_RATE_LIMITED) return null;
  const resetAt = Date.parse(String(error.params.resetAt));
  return Number.isNaN(resetAt) ? null : new Date(resetAt);
}

/** Stops the poll when the last answer used up the quota (reconcile's reads swallow the error). */
function checkRateLimit({ github }: WorkerDeps, now: Date): void {
  const limit = github.rateLimit;
  if (!limit || limit.remaining > 0) return;
  const resetAt = Date.parse(limit.resetAt);
  if (resetAt > now.getTime()) throw new RateLimited(new Date(resetAt));
}

const seenOf = (pr: GitHubPullRequest): SeenPullRequest => ({
  number: pr.number,
  headSha: pr.headSha,
  isDraft: pr.isDraft,
  state: pr.state,
  githubUpdatedAt: new Date(pr.updatedAt),
});

/**
 * The first poll: brings the app's PRs in line with GitHub like the reconcile poll (new PRs come
 * from the list, so one request), stores what it saw and starts nothing.
 */
async function baselineRepository(
  deps: WorkerDeps,
  repository: Repository,
  result: ReconcileResult,
): Promise<void> {
  const listed = await reconcileRepository(deps, repository, result, {
    importFromList: true,
    ci: false,
  });
  const open = new Set(listed.map((pr) => pr.number));
  for (const pr of listed) await storeSeenPullRequest(deps.db, repository.id, seenOf(pr.snapshot));
  // A PR seen open before an old baseline and no longer listed was closed meanwhile.
  for (const seen of await seenPullRequests(deps.db, repository.id)) {
    if (seen.state === 'open' && !open.has(seen.number)) {
      await storeSeenPullRequest(deps.db, repository.id, { ...seen, state: 'closed' });
    }
  }
}

/** Every PR that changed since the last poll, as deliveries. Returns the recorded ids. */
async function pollRepository(
  deps: WorkerDeps,
  repository: Repository,
  result: ReconcileResult,
): Promise<string[]> {
  const fullName = repository.githubFullName;
  const listed = await deps.github.listOpenPullRequests(fullName);
  const seen = new Map(
    (await seenPullRequests(deps.db, repository.id)).map((pr) => [pr.number, pr]),
  );
  const changed = listed
    .filter((pr) => pollTransitions(seen.get(pr.number) ?? null, seenOf(pr.snapshot)).length)
    .map((pr) => pr.number);
  const open = new Set(listed.map((pr) => pr.number));
  const gone = [...seen.values()]
    .filter((pr) => pr.state === 'open' && !open.has(pr.number))
    .map((pr) => pr.number);

  const recorded: string[] = [];
  for (const number of [...changed, ...gone]) {
    try {
      recorded.push(...(await deliverChange(deps, repository, seen.get(number) ?? null, number)));
    } catch (error) {
      if (rateLimitedAt(error)) throw error;
      deps.logger.warn({ err: error, repository: fullName, number }, 'github poll: PR not read');
      result.failed.push(`${fullName}#${number}`);
    }
  }
  return recorded;
}

/**
 * Reads the PR in full (the list has no commit counts) and records one delivery per webhook
 * action the change stands for. The seen state moves in the same transaction, only if no other
 * poll moved it first; that poll then has the deliveries.
 */
async function deliverChange(
  deps: WorkerDeps,
  repository: Repository,
  previous: SeenPullRequest | null,
  number: number,
): Promise<string[]> {
  const snapshot = await deps.github.getPullRequest(repository.githubFullName, number);
  const next = seenOf(snapshot);
  const actions = pollTransitions(previous, next);
  const advance = (tx: Parameters<typeof advanceSeenPullRequest>[0]) =>
    advanceSeenPullRequest(tx, repository.id, previous, next);
  if (!actions.length) {
    // The list was behind; GitHub's PR shows no change after all.
    await advance(deps.db);
    return [];
  }
  const deliveries = actions.map((action) => pollDelivery(repository, previous, snapshot, action));
  const recorded = await ingestGithubEvents(deps, deliveries, advance);
  return recorded ? deliveries.map((delivery) => delivery.deliveryId) : [];
}

/**
 * The `pull_request` delivery a webhook would carry for `action`. The id is stable for one change
 * (no colons: it is a blob key segment), so two polls that see it record it once.
 */
export function pollDelivery(
  repository: Pick<Repository, 'id' | 'githubFullName'>,
  previous: Pick<SeenPullRequest, 'headSha'> | null,
  snapshot: GitHubPullRequest,
  action: PolledAction,
): GithubDelivery {
  const payload = {
    action,
    number: snapshot.number,
    pull_request: toRawPullRequest(snapshot),
    repository: { full_name: repository.githubFullName },
    ...(action === 'synchronize' && previous
      ? { before: previous.headSha, after: snapshot.headSha }
      : {}),
  };
  const updatedMs = Date.parse(snapshot.updatedAt);
  return {
    deliveryId: `poll-${repository.id}-${snapshot.number}-${action}-${snapshot.headSha}-${updatedMs}`,
    event: 'pull_request',
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    action,
    repositoryFullName: repository.githubFullName,
    prNumber: snapshot.number,
  };
}
