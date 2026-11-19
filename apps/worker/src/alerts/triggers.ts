// S-18-T3: when alerts are re-evaluated. Every run state change (stage failed, round completed,
// chain ended, a retry or a new start, also from the api) writes `runs`; every recorded session
// cost writes `agent_sessions` and the run's cost; a PR closing writes `pull_requests`; a budget
// change writes `app_settings`. One listener on those tables covers all of them, so no stage or
// api route calls the alerts. The minute cron covers the budget at midnight.
import { listenChanges, type ChangeListener } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { requestAlertEvaluation } from './evaluate.ts';

const TRIGGER_TABLES = new Set(['runs', 'agent_sessions', 'pull_requests', 'app_settings']);

/** Changes within this window ask for one evaluation (a turn writes several rows). */
export const ALERT_THROTTLE_MS = 500;

export function listenForAlertTriggers(
  deps: WorkerDeps,
  throttleMs: number = ALERT_THROTTLE_MS,
): ChangeListener {
  const { logger } = deps;
  let timer: NodeJS.Timeout | null = null;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      requestAlertEvaluation(deps.queue).catch((error: unknown) =>
        logger.warn({ err: error }, 'alert evaluation could not be requested'),
      );
    }, throttleMs);
  };
  const listener = listenChanges(
    deps.db,
    (change) => {
      if (TRIGGER_TABLES.has(change.table)) request();
    },
    {
      // Changes in the gap were not delivered.
      onReconnect: request,
      onError: (error) => logger.warn({ err: error }, 'alert change listener error'),
    },
  );
  return {
    ...listener,
    async close() {
      if (timer) clearTimeout(timer);
      timer = null;
      await listener.close();
    },
  };
}
