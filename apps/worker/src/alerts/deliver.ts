// S-18-T4 (FR-066): each new alert becomes one ClickUp comment, posted with the app's ClickUp key
// and signed "pr-review-agent" in the text. It goes to the PR's linked task, or to the general
// alerts task for budget alerts and PRs without a task. Without a key, the app's address or a
// task, the alert stays in the app as "Not sent: ClickUp not configured"; nothing is faked.
import { alertCommentText } from '@pra/core';
import {
  anyClickUpSettings,
  getAlert,
  pullRequestAndRepository,
  readRepositoryConfig,
  setAlertDelivery,
  type QueueJob,
} from '@pra/db';
import { CLICKUP_NOT_CONFIGURED, type ClickUpSettings } from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import { canDeliver } from './evaluate.ts';

export type DeliveryOutcome = 'sent' | 'already_sent' | 'not_configured' | 'missing';

/** `${APP_BASE_URL}/pr/<repo>/<number>` (no trailing slash doubled). */
export const appLink = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

const isNotConfigured = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === CLICKUP_NOT_CONFIGURED;

export async function deliverAlert(deps: WorkerDeps, alertId: number): Promise<DeliveryOutcome> {
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

  if (!canDeliver(deps, alert.clickupTaskId) || !settings) {
    await setAlertDelivery(db, alert.id, { status: 'not_configured' });
    return 'not_configured';
  }
  const text = alertCommentText({
    title: alert.title,
    nextStep: alert.nextStep,
    prNumber,
    link: appLink(deps.appBaseUrl!, path),
  });
  try {
    const comment = await deps.clickup.createComment(settings, alert.clickupTaskId!, { text });
    await setAlertDelivery(db, alert.id, { status: 'sent', commentId: comment.id });
    return 'sent';
  } catch (error) {
    if (isNotConfigured(error)) {
      await setAlertDelivery(db, alert.id, { status: 'not_configured' });
      return 'not_configured';
    }
    // Shown in the app while pg-boss retries with backoff; a later success sets `sent`.
    await setAlertDelivery(db, alert.id, { status: 'failed' });
    throw error;
  }
}

export async function handleAlertDeliveries(
  deps: WorkerDeps,
  jobs: QueueJob<'alerts.deliver'>[],
): Promise<void> {
  for (const job of jobs) {
    const outcome = await deliverAlert(deps, job.data.alertId);
    deps.logger.info({ alertId: job.data.alertId, outcome }, 'alert delivery');
  }
}
