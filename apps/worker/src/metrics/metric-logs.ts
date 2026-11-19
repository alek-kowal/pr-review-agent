// S-19-T1: the worker's writers of metric source rows. PR event hooks log ready, close, merge
// and head moves as GitHub reports them; `backfillMetricLogs` writes the same rows from the raw
// events kept since S-01, so the metrics cover the pilot from its first PR.
import {
  getGithubEvent,
  getPullRequest,
  getRepositoryByFullName,
  hasHeadChangeFor,
  recordHeadChange,
  recordPrClosed,
  recordPrReady,
  type GithubEvent,
  type PullRequest,
} from '@pra/db';
import { toPullRequest, type GitHubPullRequest, type RawPullRequest } from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import type { PrEventContext, PrEventHook } from '../github-events/pr-hooks.ts';

type Sender = { login?: unknown; type?: unknown };

/** What the metric writers use of the worker's dependencies. */
export type MetricLogDeps = Pick<WorkerDeps, 'db' | 'blobStore' | 'github' | 'logger'>;

/** A push by a GitHub App or a bot account (`type: 'Bot'`, login ending in `[bot]`). */
export function pushedByBot(sender: Sender | undefined): boolean {
  if (!sender) return false;
  return (
    sender.type === 'Bot' || (typeof sender.login === 'string' && sender.login.endsWith('[bot]'))
  );
}

async function eventTime(deps: MetricLogDeps, eventId: number): Promise<Date> {
  return (await getGithubEvent(deps.db, eventId))?.receivedAt ?? new Date();
}

/** Logs one head move from a `pull_request` payload; asks GitHub for the new head commit. */
async function logHeadChange(
  deps: MetricLogDeps,
  change: {
    pullRequest: PullRequest;
    snapshot: GitHubPullRequest;
    payload: Record<string, unknown>;
    previousHeadSha: string;
    eventId: number;
    at: Date;
  },
): Promise<void> {
  const { snapshot, payload } = change;
  const sender = payload.sender as Sender | undefined;
  const beforeSha = typeof payload.before === 'string' ? payload.before : change.previousHeadSha;
  const afterSha = typeof payload.after === 'string' ? payload.after : snapshot.headSha;
  const byBot = pushedByBot(sender);
  // A bot's push never counts for metric 5, so only a person's push needs its commit.
  const commit = byBot
    ? null
    : await deps.github.getCommit(snapshot.fullName, afterSha).catch((error: unknown) => {
        deps.logger.warn(
          { err: error, pr: snapshot.number, sha: afterSha },
          'head commit unavailable; the head change is not marked as a base merge',
        );
        return null;
      });
  await recordHeadChange(deps.db, {
    pullRequestId: change.pullRequest.id,
    githubEventId: change.eventId,
    beforeSha,
    afterSha,
    pusher: typeof sender?.login === 'string' ? sender.login : null,
    byBot,
    baseSha: snapshot.baseSha,
    commit,
    at: change.at,
  });
}

function closedOf(snapshot: GitHubPullRequest, at: Date) {
  const date = (value: string | null) => (value ? new Date(value) : at);
  return {
    at: date(snapshot.closedAt),
    merged:
      snapshot.state === 'merged' ? { at: date(snapshot.mergedAt), sha: snapshot.mergeSha } : null,
  };
}

export const metricsOnReady: PrEventHook = async ({ deps, pullRequest, eventId }) => {
  await recordPrReady(deps.db, pullRequest.id, await eventTime(deps, eventId));
};

export const metricsOnHeadChanged: PrEventHook = async (context: PrEventContext) => {
  const { deps, pullRequest, previous, snapshot, payload, eventId } = context;
  await logHeadChange(deps, {
    pullRequest,
    snapshot,
    payload,
    previousHeadSha: previous?.headSha ?? snapshot.baseSha,
    eventId,
    at: await eventTime(deps, eventId),
  });
};

/** Closed and merged alike: GitHub's close and merge times and its merge commit. */
export const metricsOnClosed: PrEventHook = async ({ deps, pullRequest, snapshot, eventId }) => {
  await recordPrClosed(deps.db, pullRequest.id, closedOf(snapshot, await eventTime(deps, eventId)));
};

export type BackfillResult = { events: number; ready: number; headChanges: number; closed: number };

/**
 * Writes metric rows from every stored `pull_request` event, oldest first. Safe to run again:
 * `ready_at` keeps its first value, a head change is written once per event, and a close is
 * rewritten with the same values.
 */
export async function backfillMetricLogs(
  deps: MetricLogDeps,
  events: AsyncIterable<GithubEvent> | Iterable<GithubEvent>,
): Promise<BackfillResult> {
  const result: BackfillResult = { events: 0, ready: 0, headChanges: 0, closed: 0 };
  // The head before each event, per PR, as the events replay.
  const heads = new Map<number, string>();
  for await (const event of events) {
    if (event.event !== 'pull_request') continue;
    const blob = await deps.blobStore.get(event.blobKey);
    if (!blob) continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(blob.body).toString('utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const raw = payload.pull_request as RawPullRequest | undefined;
    if (!raw?.base?.repo?.full_name || !raw.head) continue;
    const snapshot = toPullRequest(raw);
    const repository = await getRepositoryByFullName(deps.db, snapshot.fullName);
    if (!repository) continue;
    const pullRequest = await getPullRequest(deps.db, repository.id, snapshot.number);
    if (!pullRequest) continue;
    result.events += 1;

    const action = event.action ?? (typeof payload.action === 'string' ? payload.action : '');
    const at = event.receivedAt;
    if (action === 'ready_for_review' || (action === 'opened' && !snapshot.isDraft)) {
      await recordPrReady(deps.db, pullRequest.id, at);
      result.ready += 1;
    }
    const previousHeadSha = heads.get(pullRequest.id);
    if (action === 'synchronize' && !(await hasHeadChangeFor(deps.db, event.id))) {
      await logHeadChange(deps, {
        pullRequest,
        snapshot,
        payload,
        previousHeadSha: previousHeadSha ?? snapshot.baseSha,
        eventId: event.id,
        at,
      });
      result.headChanges += 1;
    }
    if (action === 'closed') {
      await recordPrClosed(deps.db, pullRequest.id, closedOf(snapshot, at));
      result.closed += 1;
    }
    heads.set(pullRequest.id, snapshot.headSha);
  }
  return result;
}
