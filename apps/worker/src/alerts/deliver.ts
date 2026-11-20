// S-18-T4 (FR-066): each new alert becomes one ClickUp comment, posted with the app's ClickUp key
// and signed "pr-review-agent" in the text. It goes to the PR's linked task, or to the general
// alerts task for budget alerts and PRs without a task. Without a key, the app's address or a
// task, the alert stays in the app as not sent, with the reason; nothing is faked.
// ALERTTL: the PR timeline entry about the comment is written here, after the attempt.
import { alertCommentText, reason, type AlertNotSentReason } from '@pra/core';
import {
  anyClickUpSettings,
  getAlert,
  pullRequestAndRepository,
  QUEUE_SETTINGS,
  readRepositoryConfig,
  setAlertDelivery,
  type QueueJob,
} from '@pra/db';
import { CLICKUP_NOT_CONFIGURED, type ClickUpSettings } from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import { recordAlertDelivery } from './delivery-entry.ts';
import { deliveryBlocker } from './evaluate.ts';

export type DeliveryOutcome = 'sent' | 'already_sent' | 'not_configured' | 'missing';

/** Where the delivery job stands: pg-boss runs it again while `retryCount < retryLimit`. */
export type DeliveryAttempt = { retryCount: number; retryLimit: number };

/** The first run of a job with the queue's own retry limit. */
export const FIRST_ATTEMPT: DeliveryAttempt = {
  retryCount: 0,
  retryLimit: QUEUE_SETTINGS['alerts.deliver']?.retryLimit ?? 0,
};

/** `${APP_BASE_URL}/pr/<repo>/<number>` (no trailing slash doubled). */
export const appLink = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

const codeOf = (error: unknown): string | null => {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : 0;
  return typeof code === 'string' ? code : null;
};

/** The env vars a `clickup_not_configured` error names. */
function missingOf(error: unknown): string[] {
  const missing = (error as { params?: { missing?: unknown } }).params?.missing;
  return Array.isArray(missing) ? missing.map(String) : [];
}

export async function deliverAlert(
  deps: WorkerDeps,
  alertId: number,
  attempt: DeliveryAttempt = FIRST_ATTEMPT,
): Promise<DeliveryOutcome> {
  const { db } = deps;
  const alert = await getAlert(db, alertId);
  if (!alert) return 'missing';
  // A job delivered twice posts once.
  if (alert.deliveryStatus === 'sent') return 'already_sent';

  let settings: ClickUpSettings | null;
  let prNumber: number | null = null;
  let path = '/activity';
  if (alert.pullRequestId != null) {
    const found = await pullRequestAndRepository(db, alert.pullRequestId);
    if (!found) return 'missing';
    const { pullRequest, repository } = found;
    settings = readRepositoryConfig(repository).value.clickup ?? (await anyClickUpSettings(db));
    prNumber = pullRequest.number;
    path = `/pr/${encodeURIComponent(repository.slug)}/${pullRequest.number}`;
  } else {
    settings = await anyClickUpSettings(db);
  }

  const notSent = async (why: AlertNotSentReason): Promise<DeliveryOutcome> => {
    await setAlertDelivery(db, alert.id, { status: 'not_configured', reason: why });
    await recordAlertDelivery(db, alert, { status: 'not_sent', reason: why });
    return 'not_configured';
  };

  const blocker = deliveryBlocker(deps, {
    taskId: alert.clickupTaskId,
    forPr: alert.pullRequestId != null,
  });
  if (blocker) return notSent(blocker);
  if (!settings) return notSent(reason('alert_delivery_clickup_off'));

  const text = alertCommentText({
    title: alert.title,
    nextStep: alert.nextStep,
    prNumber,
    link: appLink(deps.appBaseUrl!, path),
    apiEquivalent: deps.modelAuth === 'subscription',
  });
  let commentId: string;
  try {
    commentId = (await deps.clickup.createComment(settings, alert.clickupTaskId!, { text })).id;
  } catch (error) {
    if (codeOf(error) === CLICKUP_NOT_CONFIGURED) {
      return notSent(reason('alert_delivery_no_key', { missing: missingOf(error) }));
    }
    // pg-boss retries with backoff while it has retries left; a later success sets `sent`.
    const failed = reason('alert_delivery_failed', {
      willRetry: attempt.retryCount < attempt.retryLimit,
      attempt: attempt.retryCount + 1,
      attempts: attempt.retryLimit + 1,
      errorCode: codeOf(error),
    });
    await setAlertDelivery(db, alert.id, { status: 'failed', reason: failed });
    await recordAlertDelivery(db, alert, { status: 'failed', reason: failed });
    throw error;
  }
  await setAlertDelivery(db, alert.id, { status: 'sent', commentId });
  await recordAlertDelivery(db, alert, { status: 'sent' });
  return 'sent';
}

export async function handleAlertDeliveries(
  deps: WorkerDeps,
  jobs: (QueueJob<'alerts.deliver'> & Partial<DeliveryAttempt>)[],
): Promise<void> {
  for (const job of jobs) {
    const outcome = await deliverAlert(deps, job.data.alertId, {
      retryCount: job.retryCount ?? FIRST_ATTEMPT.retryCount,
      retryLimit: job.retryLimit ?? FIRST_ATTEMPT.retryLimit,
    });
    deps.logger.info({ alertId: job.data.alertId, outcome }, 'alert delivery');
  }
}
