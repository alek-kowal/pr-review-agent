// GitHub deliveries into the app: each payload into the blob store unchanged, one `github_events`
// row per delivery id, and a `github.event` job with a fixed id. The webhook route and the poller
// (P-28) both come in here, so the worker handles a polled change exactly like a webhook.
import type { Db, Executor } from './client.ts';
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
 * Stores deliveries once and queues their jobs. A second call with the same ids (a redelivery, or
 * two polls that saw the same change) writes the same blobs, adds no row and no job. `guard` runs
 * in the transaction that records the rows; false records nothing and gives null (the poller's
 * compare-and-set on its seen state). A job lost after the commit is sent again by the worker's
 * recovery of unprocessed events.
 */
export async function ingestGithubEvents(
  deps: { db: Db; queue: Queue; blobStore: DeliveryBlobStore },
  deliveries: readonly GithubDelivery[],
  guard?: (tx: Executor) => Promise<boolean>,
): Promise<{ event: GithubEvent; created: boolean }[] | null> {
  // Same key and bytes on a redelivery, so writing again is harmless.
  for (const delivery of deliveries) {
    await deps.blobStore.put(githubEventBlobKey(delivery.deliveryId), delivery.rawBody, {
      contentType: 'application/json',
    });
  }
  const recorded = await deps.db.transaction(async (tx) => {
    if (guard && !(await guard(tx))) return null;
    const rows = [];
    for (const delivery of deliveries) {
      rows.push(
        await recordGithubEvent(tx, {
          deliveryId: delivery.deliveryId,
          event: delivery.event,
          action: delivery.action,
          repositoryFullName: delivery.repositoryFullName,
          prNumber: delivery.prNumber,
          blobKey: githubEventBlobKey(delivery.deliveryId),
        }),
      );
    }
    return rows;
  });
  if (!recorded) return null;
  for (const [i, { event }] of recorded.entries()) {
    // A fixed job id per delivery: a redelivery (or a retry after a failed send) adds no job.
    await sendJob(
      deps.queue,
      JOBS.githubEvent,
      { eventId: event.id },
      { id: githubEventJobId(deliveries[i]!.deliveryId) },
    );
  }
  return recorded;
}
