import {
  GITHUB_MODES,
  GitHubPollScheduleSchema,
  githubPolls,
  nextPollAt,
  pollWindowOpen,
  type GitHubPollSchedule,
} from '@pra/core';
import {
  getAppSettings,
  getGithubPoller,
  githubDeliveryStats,
  JOBS,
  lastClickUpCall,
  listPollRepositories,
  sendJob,
  type Db,
  type GithubEvent,
} from '@pra/db';
import type { AccessibleRepository } from '@pra/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import {
  INTEGRATIONS_ENTITY,
  integrationSettingsOf,
  integrationsStore,
  type IntegrationSettings,
} from '../../../../settings/integrations-store.ts';
import { GITHUB_POLL_ENTITY, githubPollStore } from '../../../../settings/github-poll-store.ts';
import { applySignedSettingsChange } from '../../../../settings/signed-change.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const Reason = z.object({ code: z.string(), params: z.record(z.string(), z.unknown()) });
const IntegrationSettingsSchema = z.object({ afterRoundGithubComment: z.boolean() });

/** The poll schedule as stored and sent: every field set. */
const PollScheduleSchema = z.object({
  intervalMinutes: z.number().int(),
  from: z.string(),
  to: z.string(),
  days: z.array(z.number().int()),
  timeZone: z.string(),
});

const PollerSchema = z.object({
  schedule: PollScheduleSchema,
  /** Whether the schedule's window is open now. */
  windowOpen: z.boolean(),
  lastStartedAt: z.iso.datetime().nullable(),
  lastFinishedAt: z.iso.datetime().nullable(),
  /** When the next scheduled poll is due (after a backoff, its end). */
  nextPollAt: z.iso.datetime(),
  /** Why the last poll failed or stopped; null when it went through. */
  lastError: Reason.nullable(),
  /** Set while GitHub's rate limit holds every poll. */
  backoffUntil: z.iso.datetime().nullable(),
  rateLimit: z
    .object({ limit: z.number().int(), remaining: z.number().int(), resetAt: z.iso.datetime() })
    .nullable(),
  repositories: z.array(
    z.object({
      fullName: z.string(),
      /** The first poll's time: open PRs then were imported without a review. */
      baselineAt: z.iso.datetime().nullable(),
      lastPolledAt: z.iso.datetime().nullable(),
      openCount: z.number().int(),
    }),
  ),
});

/** Core's `GitHubPollScheduleSchema` checks the schedule itself (window, days, time zone). */
const PollBody = z.object({
  intervalMinutes: z.number().int(),
  from: z.string(),
  to: z.string(),
  days: z.array(z.number().int()),
  timeZone: z.string(),
  /** The schedule the signer saw; a change made in between gives 409 `settings_stale`. */
  before: PollScheduleSchema.optional(),
  signedBy: z.string().trim().optional(),
});
const PollResponse = z.object({ schedule: PollScheduleSchema });
const PollNowResponse = z.object({ queued: z.boolean() });

export const IntegrationsResponse = z.object({
  github: z.object({
    /** False when any of the App's env vars is missing; `missing` names them. */
    configured: z.boolean(),
    missing: z.array(z.string()),
    installations: z.array(
      z.object({ id: z.number().int(), account: z.string(), repositoryCount: z.number().int() }),
    ),
    repositories: z.array(
      z.object({
        fullName: z.string(),
        installationId: z.number().int(),
        account: z.string(),
        private: z.boolean(),
      }),
    ),
    /** Why installations and repositories could not be listed; null when they were. */
    listError: Reason.nullable(),
    deliveries: z.object({
      last: z
        .object({
          deliveryId: z.string(),
          event: z.string(),
          action: z.string().nullable(),
          repositoryFullName: z.string().nullable(),
          receivedAt: z.iso.datetime(),
          processedAt: z.iso.datetime().nullable(),
        })
        .nullable(),
      last24h: z.number().int(),
      signatureFailures24h: z.number().int(),
      lastSignatureFailureAt: z.iso.datetime().nullable(),
    }),
    /** No reconcile poll exists yet; null until one does. */
    lastReconcilePoll: z.iso.datetime().nullable(),
    /** `app`, or read-only polling with a personal token (`token`) or none (`anonymous`). */
    mode: z.enum(GITHUB_MODES),
    /** The poller without the App (P-28); null in App mode. */
    poller: PollerSchema.nullable(),
  }),
  clickup: z.object({
    configured: z.boolean(),
    missing: z.array(z.string()),
    /** The newest Task stage that called ClickUp; null when none has. */
    lastCall: z
      .object({ at: z.iso.datetime(), ok: z.boolean(), error: Reason.nullable() })
      .nullable(),
  }),
  settings: IntegrationSettingsSchema,
});

export const ClickUpTestResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), user: z.object({ id: z.string(), username: z.string() }) }),
  z.object({ ok: z.literal(false), error: Reason }),
]);

const SettingsBody = IntegrationSettingsSchema.extend({
  /** The settings the signer saw; when sent, a change made in between gives 409 `settings_stale`. */
  before: IntegrationSettingsSchema.optional(),
  signedBy: z.string().trim().optional(),
});
const SettingsResponse = z.object({ settings: IntegrationSettingsSchema });

/**
 * Settings → Integrations (S-20-T6, FR-079): whether GitHub and ClickUp are configured and
 * healthy, a ClickUp connection test, and the signed after-round GitHub comment switch. Missing
 * credentials read as "not configured", never as a success.
 */
const integrations: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, github, clickup, queue } = fastify.deps;
  const store = integrationsStore();
  const pollStore = githubPollStore();

  fastify.get('/', { schema: { response: { 200: IntegrationsResponse } } }, async () => {
    const since = new Date(Date.now() - DAY_MS);
    const githubMissing = [...github.missingEnv];
    let reachable: AccessibleRepository[] = [];
    let listError: z.infer<typeof Reason> | null = null;
    if (githubMissing.length === 0) {
      try {
        reachable = await github.listAccessibleRepositories();
      } catch (error) {
        listError = reasonOf(error, 'github_error');
        fastify.log.warn({ err: error }, 'listing the GitHub App repositories failed');
      }
    }
    const [deliveries, call, settings] = await Promise.all([
      githubDeliveryStats(db, since),
      lastClickUpCall(db),
      getAppSettings(db),
    ]);
    const poller = githubPolls(github.mode)
      ? await pollerView(db, settings.value.githubPoll, new Date())
      : null;
    const failures = fastify.signatureFailures.since(since);
    const clickupMissing = [...clickup.missingEnv];

    return {
      github: {
        configured: githubMissing.length === 0,
        missing: githubMissing,
        installations: installationsOf(reachable),
        repositories: reachable.map(({ fullName, installationId, account, private: p }) => ({
          fullName,
          installationId,
          account,
          private: p,
        })),
        listError,
        deliveries: {
          last: deliveries.last ? delivery(deliveries.last) : null,
          last24h: deliveries.count,
          signatureFailures24h: failures.count,
          lastSignatureFailureAt: failures.last?.toISOString() ?? null,
        },
        lastReconcilePoll: null,
        mode: github.mode,
        poller,
      },
      clickup: {
        configured: clickupMissing.length === 0,
        missing: clickupMissing,
        lastCall:
          call?.finishedAt == null
            ? null
            : {
                at: call.finishedAt.toISOString(),
                ok: call.status === 'succeeded',
                error:
                  call.status === 'succeeded'
                    ? null
                    : { code: call.errorCode ?? 'clickup_error', params: {} },
              },
      },
      settings: integrationSettingsOf(settings.value),
    };
  });

  fastify.post(
    '/clickup/test',
    { schema: { response: { 200: ClickUpTestResponse } } },
    async (request) => {
      try {
        return { ok: true as const, user: await clickup.whoAmI() };
      } catch (error) {
        request.log.info({ err: error }, 'ClickUp connection test failed');
        return { ok: false as const, error: reasonOf(error, 'clickup_error') };
      }
    },
  );

  fastify.put(
    '/',
    {
      schema: {
        body: SettingsBody,
        response: { 200: SettingsResponse, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { before, signedBy, ...after } = request.body;
      const result = await applySignedSettingsChange<IntegrationSettings>(db, {
        store,
        entity: INTEGRATIONS_ENTITY,
        // Without `before` the stored value counts as seen: only `sameJson` reads it.
        before: before ?? integrationSettingsOf((await getAppSettings(db)).value),
        after,
        signer: signedBy,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      return { settings: result.value! };
    },
  );

  /** The poll schedule (P-28), signed like every settings write. */
  fastify.put(
    '/poll',
    {
      schema: {
        body: PollBody,
        response: { 200: PollResponse, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { before, signedBy, ...fields } = request.body;
      const parsed = GitHubPollScheduleSchema.safeParse(fields);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        return sendError(reply, 400, ApiErrorCode.InvalidRequest, {
          part: 'body',
          field: issue.path.join('.'),
          reason: issue.message,
        });
      }
      const result = await applySignedSettingsChange<GitHubPollSchedule>(db, {
        store: pollStore,
        entity: GITHUB_POLL_ENTITY,
        before: before ?? (await getAppSettings(db)).value.githubPoll,
        after: parsed.data,
        signer: signedBy,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      return { schedule: result.value! };
    },
  );

  /**
   * Poll now: one poll at once, inside or outside the window, not during a rate-limit backoff.
   * Not signed (like Start review). `queued` false: a poll is already waiting.
   */
  fastify.post(
    '/poll-now',
    { schema: { response: { 202: PollNowResponse, 409: ApiErrorSchema } } },
    async (_request, reply) => {
      if (!githubPolls(github.mode)) return sendError(reply, 409, ApiErrorCode.GithubPollOff);
      const id = await sendJob(queue, JOBS.githubPoll, { force: true });
      return reply.code(202).send({ queued: id !== null });
    },
  );
};

async function pollerView(db: Db, schedule: GitHubPollSchedule, now: Date) {
  const [poller, repositories] = await Promise.all([getGithubPoller(db), listPollRepositories(db)]);
  const iso = (date: Date | null) => date?.toISOString() ?? null;
  const due = nextPollAt(schedule, now, poller.lastStartedAt);
  const backoff = poller.backoffUntil && poller.backoffUntil > now ? poller.backoffUntil : null;
  return {
    schedule,
    windowOpen: pollWindowOpen(schedule, now),
    lastStartedAt: iso(poller.lastStartedAt),
    lastFinishedAt: iso(poller.lastFinishedAt),
    nextPollAt: (backoff && backoff > due ? backoff : due).toISOString(),
    lastError: poller.lastError ?? null,
    backoffUntil: iso(backoff),
    rateLimit: poller.rateLimit ?? null,
    repositories: repositories.map((r) => ({
      fullName: r.fullName,
      baselineAt: iso(r.baselineAt),
      lastPolledAt: iso(r.lastPolledAt),
      openCount: r.openCount,
    })),
  };
}

function installationsOf(repositories: AccessibleRepository[]) {
  const byId = new Map<number, { id: number; account: string; repositoryCount: number }>();
  for (const r of repositories) {
    const entry = byId.get(r.installationId) ?? {
      id: r.installationId,
      account: r.account,
      repositoryCount: 0,
    };
    entry.repositoryCount += 1;
    byId.set(r.installationId, entry);
  }
  return [...byId.values()].sort((a, b) => a.account.localeCompare(b.account));
}

function delivery(event: GithubEvent) {
  return {
    deliveryId: event.deliveryId,
    event: event.event,
    action: event.action,
    repositoryFullName: event.repositoryFullName,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}

/** An integration error's code and params (by shape: routes load through autoload's import). */
function reasonOf(error: unknown, fallback: string): z.infer<typeof Reason> {
  const failure = error as { code?: unknown; params?: unknown } | null;
  if (typeof failure?.code !== 'string') return { code: fallback, params: {} };
  const params =
    failure.params && typeof failure.params === 'object' && !Array.isArray(failure.params)
      ? (failure.params as Record<string, unknown>)
      : {};
  return { code: failure.code, params };
}

export default integrations;
