// ClickUp follow-up tasks (S-06-T5, FR-042): one task per finding deferred to ClickUp, in the
// linked task's list, else the repository's follow-up list. The api sends the job when a Defer
// decision is saved, delayed past its Undo; an undone batch creates nothing. Each finding's
// result (the task, or why there is none) is stored on its decision.
import { BOT } from '@pra/core';
import {
  claimFollowUp,
  deferBatchesWithoutFollowUp,
  FOLLOW_UP_DELAY_SECONDS,
  followUpItems,
  getDecisionBatch,
  getTaskLink,
  JOBS,
  pullRequestAndRepository,
  readRepositoryConfig,
  recordFollowUp,
  recordTimelineEntry,
  sendJob,
  type FollowUpItem,
  type FollowUpReason,
  type QueueJob,
} from '@pra/db';
import { CLICKUP_NOT_CONFIGURED, type ClickUpSettings } from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import { pullRequestUrl } from '../stages/task.ts';

/** Sends a batch's follow-up job, delayed past the decision's Undo; one per batch at a time. */
export const sendFollowUpJob = (
  queue: WorkerDeps['queue'],
  batchId: number,
  startAfter: number = FOLLOW_UP_DELAY_SECONDS,
) => sendJob(queue, JOBS.clickupFollowUp, { batchId }, { singletonKey: `${batchId}`, startAfter });

const RESEND_WITHIN_MS = 24 * 60 * 60_000;
const RESEND_AFTER_MS = FOLLOW_UP_DELAY_SECONDS * 1000 + 60_000;

/** Resends the job of a Defer batch whose job never ran (the api's send was lost). */
export async function resendLostFollowUps(deps: WorkerDeps, now: Date): Promise<number[]> {
  const batches = await deferBatchesWithoutFollowUp(deps.db, {
    from: new Date(now.getTime() - RESEND_WITHIN_MS),
    to: new Date(now.getTime() - RESEND_AFTER_MS),
  });
  for (const batchId of batches) await sendFollowUpJob(deps.queue, batchId, 0);
  return batches;
}

export async function handleFollowUps(
  deps: WorkerDeps,
  jobs: QueueJob<'clickup.follow-up'>[],
): Promise<void> {
  for (const job of jobs) await createFollowUps(deps, job.data.batchId);
}

export type FollowUpOutcome =
  | { findingId: number; result: 'created'; taskId: string }
  | { findingId: number; result: 'failed'; reason: FollowUpReason }
  | { findingId: number; result: 'undone' | 'already_created' };

const reason = (code: string, params: Record<string, unknown> = {}): FollowUpReason => ({
  code,
  params,
});

/** An integration error's code and params, by shape (the gateway's class may be another copy). */
function failureOf(error: unknown): FollowUpReason | null {
  const failure = error as { name?: unknown; code?: unknown; params?: unknown } | null;
  if (!(error instanceof Error) || !String(failure?.name).startsWith('Integration')) return null;
  if (typeof failure?.code !== 'string') return null;
  const params =
    failure.params && typeof failure.params === 'object' && !Array.isArray(failure.params)
      ? (failure.params as Record<string, unknown>)
      : {};
  return reason(failure.code, params);
}

/**
 * Creates the batch's missing follow-up tasks. ClickUp off (no repository settings or no key) or
 * no list to create in is stored on each finding and ends the job; a ClickUp failure is stored
 * too and rethrown after the other findings, so pg-boss retries the failed ones.
 */
export async function createFollowUps(
  deps: WorkerDeps,
  batchId: number,
): Promise<FollowUpOutcome[]> {
  const { db, clickup, logger } = deps;
  const batch = await getDecisionBatch(db, batchId);
  if (!batch || batch.decision !== 'defer' || batch.undoneAt) return [];
  const found = await pullRequestAndRepository(db, batch.pullRequestId);
  if (!found) return [];
  const { pullRequest, repository } = found;
  const items = (await followUpItems(db, batchId)).filter(
    (item) => item.status !== 'created' && item.status !== 'creating',
  );
  if (items.length === 0) return [];

  const settings = readRepositoryConfig(repository).value.clickup;
  const prUrl = pullRequestUrl(repository.githubFullName, pullRequest.number);
  const outcomes: FollowUpOutcome[] = [];
  let retry: unknown = null;

  const fail = async (item: FollowUpItem, why: FollowUpReason) => {
    await recordFollowUp(db, batchId, item.findingId, { error: why });
    outcomes.push({ findingId: item.findingId, result: 'failed', reason: why });
  };

  let target: { listId: string } | { error: FollowUpReason };
  try {
    target = settings
      ? await followUpList(deps, settings, pullRequest.id)
      : { error: reason(CLICKUP_NOT_CONFIGURED, { missing: ['RepositoryConfig.clickup'] }) };
  } catch (error) {
    const why = failureOf(error);
    if (!why) throw error;
    target = { error: why };
    if (why.code !== CLICKUP_NOT_CONFIGURED) retry = error;
  }
  if ('error' in target) {
    // Nothing to claim: no task is being created, so a later Undo or retry stays possible.
    for (const item of items) await fail(item, target.error);
    if (retry) throw retry;
    return outcomes;
  }

  for (const item of items) {
    const claim = await claimFollowUp(db, batchId, item.findingId);
    if (claim !== 'claimed') {
      outcomes.push({ findingId: item.findingId, result: claim });
      if (claim === 'undone') break;
      continue;
    }
    try {
      const task = await clickup.createTask(settings, target.listId, {
        name: item.title,
        description: followUpDescription(item, prUrl),
      });
      await recordFollowUp(db, batchId, item.findingId, { task });
      await recordTimelineEntry(db, {
        pullRequestId: pullRequest.id,
        actor: BOT,
        kind: 'follow_up_created',
        params: { taskId: task.id, url: task.url, findingId: item.findingId, title: item.title },
        sourceKey: `follow_up:${batchId}:${item.findingId}`,
      });
      outcomes.push({ findingId: item.findingId, result: 'created', taskId: task.id });
    } catch (error) {
      const why = failureOf(error) ?? reason('clickup_error', {});
      logger.warn({ err: error, batchId, findingId: item.findingId }, 'follow-up task failed');
      await fail(item, why);
      if (why.code !== CLICKUP_NOT_CONFIGURED) retry ??= error;
    }
  }
  if (retry) throw retry;
  return outcomes;
}

/** The linked task's list, else the repository's follow-up list. */
async function followUpList(
  deps: WorkerDeps,
  settings: ClickUpSettings & { followUpListId?: string | null },
  pullRequestId: number,
): Promise<{ listId: string } | { error: FollowUpReason }> {
  const link = await getTaskLink(deps.db, pullRequestId);
  if (link) {
    const task = await deps.clickup.getTask(settings, link.taskId);
    if (task?.listId) return { listId: task.listId };
  }
  if (settings.followUpListId) return { listId: settings.followUpListId };
  return { error: reason('follow_up_list_missing') };
}

/** The task's description (Markdown): where, what happens, what to do, and the PR. */
export function followUpDescription(item: FollowUpItem, prUrl: string): string {
  const where = item.line === null ? item.file : `${item.file}:${item.line}`;
  return [
    `Deferred from the review of ${prUrl}.`,
    '',
    `**Where:** \`${where}\``,
    '',
    `**Scenario:** ${item.scenario}`,
    '',
    `**Suggestion:** ${item.suggestion}`,
  ].join('\n');
}
