// S-18-T5: Activity → Active alerts and past alerts, and Dismiss. Dismiss is unsigned and recorded
// "by hand" in the PR timeline; it is the only way the cost alert clears. Live updates need no
// event of their own: the `alerts` trigger sends `change` with `table: 'alerts'` over SSE.
import { HAND } from '@pra/core';
import {
  countActiveAlerts,
  countPastAlerts,
  dismissAlert,
  getAlert,
  getAlertView,
  listActiveAlerts,
  listPastAlerts,
  recordTimelineEntry,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { AlertSchema, alertView } from '../../../alerts/view.ts';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';

/** How many past alerts the list returns; `pastCount` counts them all. */
export const PAST_ALERTS_LIMIT = 100;

export const AlertsQuery = z.object({ status: z.enum(['active', 'past']).default('active') });

export const AlertsResponse = z.object({
  /** Active ones newest first; past ones the most recently ended first. */
  alerts: z.array(AlertSchema),
  activeCount: z.number().int(),
  pastCount: z.number().int(),
});

const AlertParams = z.object({ id: z.coerce.number().int().positive() });

export const DismissResponse = z.object({ alert: AlertSchema });

const alerts: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.deps;

  fastify.get(
    '/',
    { schema: { querystring: AlertsQuery, response: { 200: AlertsResponse } } },
    async (request) => {
      const past = request.query.status === 'past';
      const [rows, activeCount, pastCount] = await Promise.all([
        past ? listPastAlerts(db, PAST_ALERTS_LIMIT) : listActiveAlerts(db),
        countActiveAlerts(db),
        countPastAlerts(db),
      ]);
      return { alerts: rows.map(alertView), activeCount, pastCount };
    },
  );

  fastify.post(
    '/:id/dismiss',
    {
      schema: {
        params: AlertParams,
        response: { 200: DismissResponse, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const dismissed = await db.transaction(async (tx) => {
        const row = await dismissAlert(tx, id, 'hand');
        if (!row) return null;
        if (row.pullRequestId != null) {
          await recordTimelineEntry(tx, {
            pullRequestId: row.pullRequestId,
            actor: HAND,
            kind: 'alert_dismissed',
            params: { alertId: row.id, alertKind: row.kind, title: row.title },
            at: row.endedAt ?? new Date(),
            sourceKey: `alert:${row.id}:dismissed`,
          });
        }
        return row;
      });
      if (!dismissed) {
        const known = await getAlert(db, id);
        if (!known) return sendError(reply, 404, ApiErrorCode.AlertNotFound, { id });
        return sendError(reply, 409, ApiErrorCode.AlertNotActive, { id, status: known.status });
      }
      const view = await getAlertView(db, id);
      return { alert: alertView(view ?? { ...dismissed, pr: null }) };
    },
  );
};

export default alerts;
