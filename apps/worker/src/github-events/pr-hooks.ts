import type { GitHubPullRequest } from '@pra/integrations';
import type { PullRequest, Repository } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { metricsOnClosed, metricsOnHeadChanged, metricsOnReady } from '../metrics/metric-logs.ts';
import { chainsOnHeadChanged } from '../run/chains.ts';
import { learningOnClosed } from '../run/learning-hooks.ts';
import { sensitiveOnHeadChanged } from '../run/sensitive-files.ts';
import {
  timelineOnClosed,
  timelineOnHeadChanged,
  timelineOnMerged,
  timelineOnReady,
} from '../run/timeline-hooks.ts';

export type PrEventKind = 'ready' | 'headChanged' | 'closed' | 'merged';

export type PrEventContext = {
  deps: WorkerDeps;
  repository: Repository;
  /** The stored PR after this event. */
  pullRequest: PullRequest;
  /** The stored PR before this event; null when the event created it. */
  previous: PullRequest | null;
  /** GitHub's snapshot from the payload. */
  snapshot: GitHubPullRequest;
  action: string;
  eventId: number;
  /** The raw webhook payload (`before`, `after` and `sender` of a `synchronize`). */
  payload: Record<string, unknown>;
};

/**
 * Runs after the snapshot is stored and the round decision is made. Hooks run in order and must
 * be idempotent: a hook that throws fails the job, and pg-boss retries the whole event.
 */
export type PrEventHook = (context: PrEventContext) => Promise<void>;

export type PrEventHooks = Record<PrEventKind, PrEventHook[]>;

/**
 * - `ready`: the PR is ready for review (`ready_for_review`, or `opened` not as a draft);
 * - `headChanged`: the stored head sha moved;
 * - `closed`: closed without merging; `merged`: closed by a merge.
 *
 * Register a hook by adding it to its list.
 */
export const PR_EVENT_HOOKS: PrEventHooks = {
  ready: [timelineOnReady, metricsOnReady],
  headChanged: [
    chainsOnHeadChanged,
    sensitiveOnHeadChanged,
    timelineOnHeadChanged,
    metricsOnHeadChanged,
  ],
  closed: [timelineOnClosed, metricsOnClosed, learningOnClosed],
  merged: [timelineOnMerged, metricsOnClosed, learningOnClosed],
};

/** Which hook lists an event fires, in this order. */
export function prEventKinds(
  action: string,
  snapshot: GitHubPullRequest,
  previous: PullRequest | null,
): PrEventKind[] {
  const kinds: PrEventKind[] = [];
  if (action === 'ready_for_review' || (action === 'opened' && !snapshot.isDraft)) {
    kinds.push('ready');
  }
  if (previous && previous.headSha !== snapshot.headSha) kinds.push('headChanged');
  if (action === 'closed') kinds.push(snapshot.state === 'merged' ? 'merged' : 'closed');
  return kinds;
}
