// S-03-T7: `GET /api/prs/:repo/:number/timeline`: the time summary (core `timeSummary` over the
// PR's state log and its runs) and every timeline entry with its actor and, for run ends, the
// run's final cost. Registered by the prs routes plugin.
import { LANES, timeSummary, type PrState } from '@pra/core';
import {
  alertsByIds,
  findPullRequest,
  runsOfPullRequest,
  stateChangesOf,
  timelineOf,
  type Executor,
  type TimelineRow,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { alertView, type AlertResponse } from '../alerts/view.ts';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../plugins/errors.ts';
import { ActorSchema, iso } from './round.ts';

const timestamp = z.iso.datetime({ offset: true });
const PrParams = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

/** Runs whose cost is the PR's real spend: trials and the analyst do not count. */
const SPEND_KINDS = new Set(['round', 'implementer']);

export const TimelineResponse = z.object({
  summary: z.object({
    /** First ready-for-review state; null while the PR was never ready. */
    readyAt: timestamp.nullable(),
    outcome: z.enum(['open', 'merged', 'closed']),
    /** Ready → merged / closed, or open for (until now). */
    totalMs: z.number(),
    agentsWorkedMs: z.number(),
    waitingMs: z.number(),
    byLane: z.object(Object.fromEntries(LANES.map((lane) => [lane, z.number()]))),
    /** Cost of the PR's finished runs. */
    costUsd: z.number(),
  }),
  entries: z.array(
    z.object({
      id: z.number().int(),
      at: timestamp,
      actor: ActorSchema,
      /** The signer's name for member entries (kept after they leave the team). */
      memberName: z.string().nullable(),
      kind: z.string(),
      params: z.record(z.string(), z.unknown()),
      runId: z.number().int().nullable(),
      /** A finished run's final cost. */
      costUsd: z.number().nullable(),
    }),
  ),
});

const alertIdOf = (entry: TimelineRow): number | null => {
  const id = (entry.params as { alertId?: unknown }).alertId;
  return typeof id === 'number' ? id : null;
};

/**
 * ALERTTL: an `alert_raised` entry with no `alert_delivery` entry after it (written before the
 * delivery entries existed, or its job has not run yet) gets the alert's stored delivery state,
 * keyed by entry id. One query, and only when such entries exist.
 */
async function deliveryOfOldAlerts(
  db: Executor,
  entries: readonly TimelineRow[],
): Promise<Map<number, AlertResponse['delivery']>> {
  const delivered = new Set(
    entries.filter((entry) => entry.kind === 'alert_delivery').map(alertIdOf),
  );
  const bare = entries.filter((entry) => {
    const id = alertIdOf(entry);
    return entry.kind === 'alert_raised' && id !== null && !delivered.has(id);
  });
  const rows = await alertsByIds(db, bare.map(alertIdOf) as number[]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out = new Map<number, AlertResponse['delivery']>();
  for (const entry of bare) {
    const alert = byId.get(alertIdOf(entry)!);
    if (alert) out.set(entry.id, alertView({ ...alert, pr: null }).delivery);
  }
  return out;
}

export const timelineRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.deps;
  fastify.get(
    '/:repo/:number/timeline',
    { schema: { params: PrParams, response: { 200: TimelineResponse, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const prId = found.pullRequest.id;
      const [entries, changes, runs] = await Promise.all([
        timelineOf(db, prId),
        stateChangesOf(db, prId),
        runsOfPullRequest(db, prId),
      ]);
      const summary = timeSummary(
        changes.map((change) => ({ state: change.state as PrState, at: change.at })),
        runs.filter((run) => SPEND_KINDS.has(run.kind)),
        new Date(),
      );
      const deliveries = await deliveryOfOldAlerts(db, entries);
      return {
        summary: { ...summary, readyAt: iso(summary.readyAt) },
        entries: entries.map((entry) => ({
          id: entry.id,
          at: entry.at.toISOString(),
          actor:
            entry.actor === 'member'
              ? { kind: 'member' as const, memberId: entry.memberId ?? '' }
              : { kind: entry.actor },
          memberName: entry.memberName,
          kind: entry.kind,
          params: deliveries.has(entry.id)
            ? { ...entry.params, delivery: deliveries.get(entry.id) }
            : entry.params,
          runId: entry.runId,
          costUsd: entry.costUsd,
        })),
      };
    },
  );
};
