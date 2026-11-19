// S-03-T7 and S-10-T4: the status chip (state and today's spend) and the signed pause, resume,
// daily budget and agent slots changes (FR-021, FR-074). Each change writes one
// `settings_changes` row (area `budget`) and then wakes the queue drainer.
import { holdReason, MAX_AGENT_SLOTS, type AppSettings } from '@pra/core';
import {
  getAppSettings,
  getTeamMember,
  runsWaitingToStart,
  sendDrainJob,
  spentToday,
  type Db,
  type Queue,
} from '@pra/db';
import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import {
  applySignedSettingsChange,
  type SignedSettingsChangeInput,
} from '../../../settings/signed-change.ts';
import {
  agentSlotsOf,
  agentSlotsStore,
  AGENT_SLOTS_ENTITY,
  dailyBudgetOf,
  dailyBudgetStore,
  DAILY_BUDGET_ENTITY,
  pauseStateOf,
  statusStore,
  STATUS_ENTITY,
  type PauseState,
} from '../../../settings/status-store.ts';

export const StatusResponse = z.object({
  /** Paused wins over a reached budget. */
  state: z.enum(['running', 'paused', 'budget_reached']),
  /** The Team member who paused; null while running. */
  pausedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  pausedReason: z.string().nullable(),
  pausedAt: z.string().nullable(),
  /** Null: no budget. */
  dailyBudgetUsd: z.number().nullable(),
  agentSlots: z.number().int(),
  /** The day starts at midnight in this zone. */
  timeZone: z.string(),
  /** Cost of every agent session started since local midnight (`since`). */
  todaySpendUsd: z.number(),
  /** Start of the day the spend counts from. */
  since: z.iso.datetime({ offset: true }),
  /** Rounds that wait for their start. */
  queuedCount: z.number().int(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

/** 00:00 UTC of `now`'s day (Insights' whole-day ranges). */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const signedBy = z.string().trim().optional();
const PauseBody = z.object({ reason: z.string().trim().min(1).max(500), signedBy });
const ResumeBody = z.object({ signedBy });
/** Null: no budget (as in `AppSettingsSchema`). */
const DailyBudgetSchema = z.object({ dailyBudgetUsd: z.number().positive().nullable() });
const BudgetBody = DailyBudgetSchema.extend({
  /** What the signer saw; a change made in between gives 409 `settings_stale`. */
  before: DailyBudgetSchema.optional(),
  signedBy,
});
const AgentSlotsSchema = z.object({ agentSlots: z.number().int().min(1).max(MAX_AGENT_SLOTS) });
const SlotsBody = AgentSlotsSchema.extend({ before: AgentSlotsSchema.optional(), signedBy });

const errors = { 400: ApiErrorSchema, 409: ApiErrorSchema } as const;

/** The chip's view of the stored status. */
export async function statusView(db: Db): Promise<StatusResponse> {
  const settings = (await getAppSettings(db)).value;
  const [spent, waiting, pausedBy] = await Promise.all([
    spentToday(db, { timeZone: settings.timeZone }),
    runsWaitingToStart(db),
    settings.paused && settings.pausedBy ? getTeamMember(db, settings.pausedBy) : undefined,
  ]);
  return {
    state: stateOf(settings, spent.spentUsd),
    pausedBy: pausedBy ? { id: pausedBy.id, name: pausedBy.name } : null,
    pausedReason: settings.paused ? settings.pausedReason : null,
    pausedAt: settings.paused ? settings.pausedAt : null,
    dailyBudgetUsd: settings.dailyBudgetUsd,
    agentSlots: settings.agentSlots,
    timeZone: settings.timeZone,
    todaySpendUsd: spent.spentUsd,
    since: spent.since.toISOString(),
    queuedCount: waiting.length,
  };
}

function stateOf(settings: AppSettings, spentUsd: number): StatusResponse['state'] {
  const hold = holdReason(settings, spentUsd);
  if (!hold) return 'running';
  return hold.code === 'paused' ? 'paused' : 'budget_reached';
}

/** Wakes the drainer after a committed change; a lost wake is covered by its 1-minute cron. */
async function wakeDrainer(queue: Queue, log: FastifyBaseLogger): Promise<void> {
  await sendDrainJob(queue).catch((error: unknown) =>
    log.warn({ err: error }, 'queue drain job not sent'),
  );
}

const status: FastifyPluginAsyncZod = async (fastify) => {
  const { db, queue } = fastify.deps;
  const respond = { 200: StatusResponse, ...errors };

  fastify.get('/', { schema: { response: { 200: StatusResponse } } }, () => statusView(db));

  const stored = async () => (await getAppSettings(db)).value;

  /**
   * One signed change, then the drainer's wake and the new status. `conflict` refuses a pause
   * while paused (or a resume while running) with 409, also when it happened in between.
   */
  async function save<T>(
    reply: FastifyReply,
    log: FastifyBaseLogger,
    change: SignedSettingsChangeInput<T>,
    conflict?: { code: ApiErrorCode; when: (current: T | null) => boolean },
  ) {
    if (conflict && change.signer && conflict.when(change.before)) {
      return sendError(reply, 409, conflict.code);
    }
    const result = await applySignedSettingsChange(db, change);
    if (!result.ok) {
      if (result.code === 'settings_stale' && conflict?.when(result.params.current as T | null)) {
        return sendError(reply, 409, conflict.code);
      }
      return sendError(reply, result.status, result.code, result.params);
    }
    await wakeDrainer(queue, log);
    return statusView(db);
  }

  fastify.post(
    '/pause',
    { schema: { body: PauseBody, response: respond } },
    async (request, reply) => {
      const { reason, signedBy: signer } = request.body;
      return save<PauseState>(
        reply,
        request.log,
        {
          store: statusStore(),
          entity: STATUS_ENTITY,
          before: pauseStateOf(await stored()),
          after: { paused: true, reason, by: signer ?? null },
          signer,
        },
        { code: ApiErrorCode.AlreadyPaused, when: (current) => current?.paused === true },
      );
    },
  );

  fastify.post(
    '/resume',
    { schema: { body: ResumeBody, response: respond } },
    async (request, reply) =>
      save<PauseState>(
        reply,
        request.log,
        {
          store: statusStore(),
          entity: STATUS_ENTITY,
          before: pauseStateOf(await stored()),
          after: { paused: false, reason: null, by: null },
          signer: request.body.signedBy,
        },
        { code: ApiErrorCode.NotPaused, when: (current) => current?.paused === false },
      ),
  );

  fastify.put(
    '/budget',
    { schema: { body: BudgetBody, response: respond } },
    async (request, reply) => {
      const { before, signedBy: signer, ...after } = request.body;
      return save(reply, request.log, {
        store: dailyBudgetStore(),
        entity: DAILY_BUDGET_ENTITY,
        // Without `before` the stored value counts as seen.
        before: before ?? dailyBudgetOf(await stored()),
        after,
        signer,
      });
    },
  );

  fastify.put(
    '/slots',
    { schema: { body: SlotsBody, response: respond } },
    async (request, reply) => {
      const { before, signedBy: signer, ...after } = request.body;
      return save(reply, request.log, {
        store: agentSlotsStore(),
        entity: AGENT_SLOTS_ENTITY,
        before: before ?? agentSlotsOf(await stored()),
        after,
        signer,
      });
    },
  );
};

export default status;
