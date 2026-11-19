// The `github.event` job (S-01-T6): one stored webhook delivery, processed once.
import { getGithubEvent, markGithubEventProcessed, type QueueJob } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';

export async function handleGithubEvents(
  deps: WorkerDeps,
  jobs: QueueJob<'github.event'>[],
): Promise<void> {
  for (const job of jobs) await processGithubEvent(deps, job.data.eventId);
}

/**
 * Dispatches the event by type and records the outcome code on its row. An event that already
 * has an outcome is left alone, so a repeated job changes nothing. Returns the outcome.
 */
export async function processGithubEvent(deps: WorkerDeps, eventId: number): Promise<string> {
  const { db, logger } = deps;
  const event = await getGithubEvent(db, eventId);
  if (!event) {
    logger.warn({ eventId }, 'github event not found');
    return 'event_not_found';
  }
  if (event.processedAt) return event.outcome ?? 'event_ignored';

  const handler = deps.extensions.githubEvents[event.event];
  let outcome = 'event_ignored';
  if (handler) {
    const payload = await readPayload(deps, event.blobKey);
    outcome =
      payload === 'missing'
        ? 'payload_missing'
        : payload === 'invalid'
          ? 'payload_invalid'
          : await handler({ deps, event, payload });
  }

  await markGithubEventProcessed(db, event.id, outcome);
  logger.info(
    { eventId, event: event.event, action: event.action, pr: event.prNumber, outcome },
    'github event processed',
  );
  return outcome;
}

async function readPayload(
  { blobStore }: WorkerDeps,
  key: string,
): Promise<Record<string, unknown> | 'missing' | 'invalid'> {
  const blob = await blobStore.get(key);
  if (!blob) return 'missing';
  try {
    const parsed: unknown = JSON.parse(Buffer.from(blob.body).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : 'invalid';
  } catch {
    return 'invalid';
  }
}
