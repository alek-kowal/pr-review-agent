// One GitHub delivery into the app: its payload into the blob store unchanged, one `github_events`
// row per delivery id, and the `github.event` job with a fixed id. The webhook route and the
// poller (P-28) both come in here, so the worker handles a polled change exactly like a webhook.
import type { Executor } from './client.ts';
import { recordGithubEvent, type GithubEvent } from './queries/github-events.ts';
import { githubEventJobId, JOBS, sendJob, type Queue } from './queue.ts';

/** The part of `BlobStore` (in `@pra/integrations`) a delivery needs. */
export type DeliveryBlobStore = {
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<unknown>;
};

export type GithubDelivery = {
  /** `X-GitHub-Delivery`; the poller's ids start with `poll-`. A blob key segment. */
  deliveryId: string;
  /** `X-GitHub-Event`. */
  event: string;
  rawBody: Uint8Array;
  action: string | null;
  repositoryFullName: string | null;
  prNumber: number | null;
};

/** Where a delivery's payload is kept. */
export const githubEventBlobKey = (deliveryId: string): string =>
  `github-events/${deliveryId}.json`;

/**
 * Stores a delivery once and queues its job. A second call with the same id (a redelivery, or
 * two polls that saw the same change) writes the same blob, adds no row and no job.
 */
export async function ingestGithubEvent(
  deps: { db: Executor; queue: Queue; blobStore: DeliveryBlobStore },
  delivery: GithubDelivery,
): Promise<{ event: GithubEvent; created: boolean }> {
  const blobKey = githubEventBlobKey(delivery.deliveryId);
  // Same key and bytes on a redelivery, so writing again is harmless.
  await deps.blobStore.put(blobKey, delivery.rawBody, { contentType: 'application/json' });
  const recorded = await recordGithubEvent(deps.db, {
    deliveryId: delivery.deliveryId,
    event: delivery.event,
    action: delivery.action,
    repositoryFullName: delivery.repositoryFullName,
    prNumber: delivery.prNumber,
    blobKey,
  });
  // A fixed job id per delivery: a redelivery (or a retry after a failed send) adds no job.
  await sendJob(
    deps.queue,
    JOBS.githubEvent,
    { eventId: recorded.event.id },
    { id: githubEventJobId(delivery.deliveryId) },
  );
  return recorded;
}
