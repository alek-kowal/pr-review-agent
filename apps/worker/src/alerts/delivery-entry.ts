// ALERTTL: the PR timeline says how an alert's ClickUp comment went only once that is known. The
// alert itself is one neutral `alert_raised` entry; each delivery outcome is its own
// `alert_delivery` entry, written after the attempt (or at once when nothing can be sent).
import { BOT, type AlertFailedReason, type AlertNotSentReason } from '@pra/core';
import { recordTimelineEntry, type AlertRow, type Executor } from '@pra/db';

export type AlertDeliveryResult =
  | { status: 'sent' }
  | { status: 'not_sent'; reason: AlertNotSentReason }
  | { status: 'failed'; reason: AlertFailedReason };

/**
 * One entry per outcome and alert: a failure that retries is written once (later failed attempts
 * of the same job add nothing), then the final one: sent, or failed for good.
 */
function sourceKeyOf(alertId: number, result: AlertDeliveryResult): string {
  const outcome =
    result.status === 'failed' && result.reason.params.willRetry ? 'retrying' : result.status;
  return `alert:${alertId}:delivery:${outcome}`;
}

/** Adds the delivery entry of a PR's alert; the daily budget alert has no PR timeline. */
export async function recordAlertDelivery(
  db: Executor,
  alert: AlertRow,
  result: AlertDeliveryResult,
  at?: Date,
): Promise<void> {
  if (alert.pullRequestId == null) return;
  await recordTimelineEntry(db, {
    pullRequestId: alert.pullRequestId,
    actor: BOT,
    kind: 'alert_delivery',
    params: {
      alertId: alert.id,
      alertKind: alert.kind,
      title: alert.title,
      status: result.status,
      taskId: alert.clickupTaskId,
      toGeneralTask: alert.toGeneralTask,
      reason: result.status === 'sent' ? null : result.reason,
    },
    ...(at ? { at } : {}),
    sourceKey: sourceKeyOf(alert.id, result),
  });
}
