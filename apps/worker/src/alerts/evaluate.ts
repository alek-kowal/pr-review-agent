// S-18-T3: alert evaluation. Reads every open PR's state, real spend and today's spend, asks core
// which alerts should be active, and stores fires and clears. A fire adds a PR timeline entry and
// sends its ClickUp delivery job, or records why no comment can be sent; a clear says nothing.
// The `alerts` trigger notifies SSE.
// Alerts never stop or delay a round: this runs in its own job, never inside a stage.
import {
  alertConditions,
  alertDeliveryBlocker,
  BOT,
  prState,
  reconcileAlerts,
  type AlertCondition,
  type AlertConfig,
  type AlertNotSentReason,
  type AlertPrSnapshot,
} from '@pra/core';
import {
  getAlertConfig,
  getAppSettings,
  getTaskLink,
  insertAlert,
  JOBS,
  knownAlerts,
  latestRoundRuns,
  loadPrStateInputs,
  openPullRequestIds,
  realSpendByPr,
  recordTimelineEntry,
  resolveAlerts,
  sendJob,
  spentToday,
  stableJobId,
  type AlertRow,
  type Queue,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { recordAlertDelivery } from './delivery-entry.ts';

/** `YYYY-MM-DD` of `now` in `timeZone`: the day budget alerts belong to. */
export function localDay(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Asks for an evaluation; requests made while one waits merge into it (stately queue). */
export function requestAlertEvaluation(queue: Queue): Promise<string | null> {
  return sendJob(queue, JOBS.alertsEvaluate, {});
}

/** Sends the ClickUp delivery job of one alert; a second send for the same alert is a no-op. */
export function sendAlertDelivery(queue: Queue, alertId: number): Promise<string | null> {
  return sendJob(
    queue,
    JOBS.alertsDeliver,
    { alertId },
    { id: stableJobId(`${JOBS.alertsDeliver}:${alertId}`), singletonKey: `${alertId}` },
  );
}

async function snapshotPrs(deps: WorkerDeps): Promise<AlertPrSnapshot[]> {
  const ids = await openPullRequestIds(deps.db);
  const [loads, rounds, spend] = await Promise.all([
    loadPrStateInputs(deps.db, ids),
    latestRoundRuns(deps.db, ids),
    realSpendByPr(deps.db, ids),
  ]);
  const prs: AlertPrSnapshot[] = [];
  for (const id of ids) {
    const load = loads.get(id);
    if (!load) continue;
    const state = prState(load.input);
    const round = rounds.get(id);
    const failed = state === 'stage_failed' ? load.input.failedRound : null;
    prs.push({
      prId: String(id),
      number: load.pullRequest.number,
      // The failed round's run id numbers the failure: a retry is a new run.
      failure:
        failed && round
          ? {
              no: round.id,
              runId: String(round.id),
              stage: failed.stage,
              errorCode: failed.errorCode,
              timeoutMinutes: failed.timeoutMinutes,
            }
          : null,
      roundsUsedChain:
        state === 'rounds_used' && round ? (round.chainId ?? `run-${round.id}`) : null,
      spentUsd: spend.get(id) ?? 0,
    });
  }
  return prs;
}

/** Where an alert's comment goes: the PR's linked task, else the general alerts task. */
async function targetOf(
  deps: WorkerDeps,
  condition: AlertCondition,
  config: AlertConfig,
): Promise<{ taskId: string | null; toGeneralTask: boolean }> {
  if (condition.prId) {
    const link = await getTaskLink(deps.db, Number(condition.prId));
    if (link) return { taskId: link.taskId, toGeneralTask: false };
  }
  return { taskId: config.generalTaskId, toGeneralTask: true };
}

/** Why no comment can be posted (no ClickUp key, no app address, no task); null when one can. */
export function deliveryBlocker(
  deps: WorkerDeps,
  alert: { taskId: string | null; forPr: boolean },
): AlertNotSentReason | null {
  return alertDeliveryBlocker({
    missingEnv: deps.clickup.missingEnv,
    appBaseUrl: deps.appBaseUrl,
    taskId: alert.taskId,
    forPr: alert.forPr,
  });
}

export type AlertEvaluation = { fired: AlertRow[]; resolved: AlertRow[] };

export async function evaluateAlerts(
  deps: WorkerDeps,
  now: Date = new Date(),
): Promise<AlertEvaluation> {
  const { db } = deps;
  const [config, settings] = await Promise.all([getAlertConfig(db), getAppSettings(db)]);
  const { timeZone, dailyBudgetUsd } = settings.value;
  const [prs, today] = await Promise.all([snapshotPrs(deps), spentToday(db, { timeZone, now })]);
  const conditions = alertConditions(
    { day: localDay(timeZone, now), spentTodayUsd: today.spentUsd, dailyBudgetUsd, prs },
    config,
  );
  const known = await knownAlerts(
    db,
    conditions.items.map((c) => c.key),
  );
  const changes = reconcileAlerts(known, conditions);
  const resolved = await resolveAlerts(db, changes.resolve);

  const fired: AlertRow[] = [];
  for (const condition of changes.fire) {
    const target = await targetOf(deps, condition, config);
    const blocker = deliveryBlocker(deps, {
      taskId: target.taskId,
      forPr: condition.prId != null,
    });
    const row = await insertAlert(db, {
      kind: condition.kind,
      key: condition.key,
      pullRequestId: condition.prId ? Number(condition.prId) : null,
      runId: condition.runId ? Number(condition.runId) : null,
      title: condition.title,
      nextStep: condition.nextStep,
      clickupTaskId: target.taskId,
      toGeneralTask: target.toGeneralTask,
      deliveryStatus: blocker ? 'not_configured' : 'pending',
      deliveryReason: blocker,
    });
    // Another evaluation stored the same key first.
    if (!row) continue;
    fired.push(row);
    if (row.pullRequestId != null) {
      // The alert only; what happened to its ClickUp comment is an `alert_delivery` entry.
      await recordTimelineEntry(db, {
        pullRequestId: row.pullRequestId,
        actor: BOT,
        kind: 'alert_raised',
        params: {
          alertId: row.id,
          alertKind: row.kind,
          title: row.title,
          nextStep: row.nextStep,
        },
        at: row.createdAt,
        sourceKey: `alert:${row.id}`,
      });
    }
    // Nothing can be sent, so no job runs: the timeline says so now, with the reason.
    if (blocker) {
      await recordAlertDelivery(db, row, { status: 'not_sent', reason: blocker }, row.createdAt);
    } else {
      await sendAlertDelivery(deps.queue, row.id);
    }
  }
  return { fired, resolved };
}

export async function handleAlertEvaluation(deps: WorkerDeps): Promise<void> {
  const result = await evaluateAlerts(deps);
  if (result.fired.length || result.resolved.length) {
    deps.logger.info(
      {
        fired: result.fired.map((a) => a.key),
        resolved: result.resolved.map((a) => a.key),
      },
      'alerts changed',
    );
  }
}
