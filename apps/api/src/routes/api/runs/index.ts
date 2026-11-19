// S-03-T6: Run detail and a session's full transcript. S-09: Retry (T2) and Cancel (T4), both
// unsigned ("by hand").
import { summarizeTranscript } from '@pra/agents/transcript';
import { chainState, HAND, roundLabel } from '@pra/core';
import {
  getRunContext,
  getRunDetail,
  recordTimelineEntry,
  retryRun,
  RUN_STATUSES,
  runsOfPullRequest,
  sessionOfRun,
  runRecord,
  type AgentSession,
  type Run,
} from '@pra/db';
import type { BlobStore } from '@pra/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { runSteps, stageRows } from '../../../pr-view/stepper.ts';
import {
  ActorSchema,
  iso,
  ReasonSchema,
  roundLevel,
  RoundLevelSchema,
} from '../../../pr-view/round.ts';

const timestamp = z.iso.datetime({ offset: true });
const RunParams = z.object({ id: z.coerce.number().int().positive() });
const SessionParams = RunParams.extend({ sessionId: z.coerce.number().int().positive() });

const SessionSchema = z.object({
  id: z.number().int(),
  role: z.string(),
  model: z.string(),
  status: z.string(),
  costUsd: z.number(),
  costSource: z.string(),
  turns: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  tokens: z.object({
    input: z.number().int(),
    output: z.number().int(),
    cacheRead: z.number().int(),
    cacheWrite: z.number().int(),
  }),
  /** Paths the session read; empty when its transcript is not stored. */
  filesRead: z.array(z.string()),
  actions: z.array(z.object({ tool: z.string(), target: z.string().nullable() })),
  hasTranscript: z.boolean(),
});

const RunStageSchema = z.object({
  key: z.string(),
  status: z.enum(['done', 'running', 'failed', 'queued', 'off']),
  attempt: z.number().int().nullable(),
  /** Every attempt of the stage. */
  costUsd: z.number(),
  errorCode: z.string().nullable(),
  offReason: ReasonSchema.nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  /** The latest attempt's stored output (the stage's readable result). */
  output: z.unknown(),
  /** Sessions of every attempt, oldest first. */
  sessions: z.array(SessionSchema),
  /** A retry's copy of a stage the failed run finished ("reused from the failed round"). */
  reused: z.boolean(),
});

/** A run linked by retry: its id, status and what it spent. */
const LinkedRunSchema = z.object({
  id: z.number().int(),
  status: z.enum(RUN_STATUSES),
  costUsd: z.number(),
});

export const RetryRunResponse = z.object({
  run: z.object({ id: z.number().int(), fromStage: z.string() }),
});

export const RunDetailResponse = z.object({
  run: z.object({
    id: z.number().int(),
    kind: z.string(),
    status: z.enum(RUN_STATUSES),
    level: RoundLevelSchema,
    startedBy: ActorSchema,
    trigger: z.string(),
    createdAt: timestamp,
    startedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    currentStage: z.string().nullable(),
    notChecked: z.array(z.string()),
    instructionVersions: z.array(
      z.object({
        id: z.number().int(),
        scope: z.string(),
        fileKey: z.string(),
        version: z.number().int(),
      }),
    ),
    /** The stage and error code a failed run stopped at. */
    error: z.object({ stage: z.string(), code: z.string() }).nullable(),
    /** The failed run this run retries, with its cost up to the failure. */
    retryOf: LinkedRunSchema.nullable(),
    /** The stage this retry started from. */
    retryFrom: z.string().nullable(),
    /** The run that retried this failed run, if any. */
    retriedBy: LinkedRunSchema.nullable(),
  }),
  pullRequest: z.object({
    repository: z.object({ slug: z.string() }),
    number: z.number().int(),
    title: z.string(),
  }),
  /** `round_label` ("Round 2 of 3 · started by ..."); null for a run that is not a round. */
  label: ReasonSchema.nullable(),
  stages: z.array(RunStageSchema),
  /** Sum of the run's session costs: for a failed run, what it spent up to the failure. */
  totalCostUsd: z.number(),
});

const actorOf = (run: Run): z.output<typeof ActorSchema> =>
  run.startedBy === 'member'
    ? { kind: 'member', memberId: run.startedByMemberId ?? '' }
    : { kind: run.startedBy };

async function readTranscript(blobStore: BlobStore, key: string | null): Promise<unknown[] | null> {
  if (!key) return null;
  const blob = await blobStore.get(key);
  if (!blob) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(blob.body).toString('utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function sessionView(blobStore: BlobStore, session: AgentSession) {
  const transcript = await readTranscript(blobStore, session.transcriptBlobKey);
  const { filesRead, actions } = summarizeTranscript(transcript ?? []);
  return {
    id: session.id,
    role: session.role,
    model: session.model,
    status: session.status,
    costUsd: session.costUsd,
    costSource: session.costSource,
    turns: session.turns,
    durationMs: session.durationMs,
    tokens: {
      input: session.inputTokens,
      output: session.outputTokens,
      cacheRead: session.cacheReadTokens,
      cacheWrite: session.cacheWriteTokens,
    },
    filesRead,
    actions,
    hasTranscript: transcript !== null,
  };
}

const runs: FastifyPluginAsyncZod = async (fastify) => {
  const { db, queue, blobStore } = fastify.deps;

  fastify.get(
    '/:id',
    { schema: { params: RunParams, response: { 200: RunDetailResponse, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const [detail, context] = await Promise.all([
        getRunDetail(db, request.params.id),
        getRunContext(db, request.params.id),
      ]);
      if (!detail || !context) {
        return sendError(reply, 404, ApiErrorCode.RunNotFound, request.params);
      }
      const { run, stages, sessions } = detail;
      const prRuns = await runsOfPullRequest(db, run.pullRequestId);
      const chain = chainState(prRuns.map(runRecord));
      const linked = (other: Run | undefined) =>
        other ? { id: other.id, status: other.status, costUsd: other.costUsd } : null;
      const rows = stageRows(stages, sessions);
      const steps = runSteps(run, rows);
      const views = new Map(
        await Promise.all(
          sessions.map(async (s) => [s.id, await sessionView(blobStore, s)] as const),
        ),
      );

      const stageViews = steps.map((step) => {
        const attempts = stages.filter((stage) => stage.stage === step.key);
        const latest = attempts.find((stage) => stage.attempt === step.attempt);
        const ids = new Set(attempts.map((stage) => stage.id));
        return {
          key: step.key,
          status: step.status,
          attempt: step.attempt,
          costUsd: step.costUsd,
          errorCode: step.errorCode,
          offReason: step.offReason,
          startedAt: iso(step.startedAt),
          finishedAt: iso(step.finishedAt),
          output: latest?.output ?? null,
          sessions: sessions
            .filter((s) => ids.has(s.stageExecutionId))
            .map((s) => views.get(s.id)!),
          reused: latest?.status === 'reused',
        };
      });
      const failed =
        run.status === 'failed' ? stageViews.find((stage) => stage.status === 'failed') : null;

      return {
        run: {
          id: run.id,
          kind: run.kind,
          status: run.status,
          level: roundLevel(run),
          startedBy: actorOf(run),
          trigger: run.trigger,
          createdAt: run.createdAt.toISOString(),
          startedAt: iso(run.startedAt),
          finishedAt: iso(run.finishedAt),
          currentStage: run.currentStage,
          notChecked: run.notChecked,
          instructionVersions: run.instructionVersions,
          error: failed ? { stage: failed.key, code: failed.errorCode ?? 'stage_error' } : null,
          retryOf: linked(prRuns.find((other) => other.id === run.retryOf)),
          retryFrom: run.retryFrom,
          retriedBy: linked(prRuns.find((other) => other.retryOf === run.id)),
        },
        pullRequest: {
          repository: { slug: context.repository.slug },
          number: context.pullRequest.number,
          title: context.pullRequest.title,
        },
        label: roundLabel({ id: String(run.id) }, chain),
        stages: stageViews,
        totalCostUsd: sessions.reduce((sum, s) => sum + s.costUsd, 0),
      };
    },
  );

  fastify.post(
    '/:id/retry',
    {
      schema: {
        params: RunParams,
        response: { 201: RetryRunResponse, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const result = await retryRun({ db, queue }, request.params.id, HAND, {
        // "Retry from Review started by hand"
        inTransaction: (tx, retry, failedRun, fromStage) =>
          recordTimelineEntry(tx, {
            pullRequestId: retry.pullRequestId,
            actor: HAND,
            kind: 'run_retried',
            params: {
              stage: fromStage,
              failedRunId: failedRun.id,
              runKind: retry.kind,
              roundNumber: retry.roundNo,
            },
            runId: retry.id,
            sourceKey: `run:${retry.id}:retry`,
          }),
      });
      if (!result.retried) {
        const { code, params } = result.reason;
        if (code === 'run_not_found') {
          return sendError(reply, 404, ApiErrorCode.RunNotFound, request.params);
        }
        return sendError(
          reply,
          409,
          code === 'run_active' ? ApiErrorCode.RunActive : ApiErrorCode.RunNotFailed,
          params,
        );
      }
      return reply.code(201).send({ run: { id: result.run.id, fromStage: result.fromStage } });
    },
  );

  fastify.get(
    '/:id/sessions/:sessionId/transcript',
    {
      schema: {
        params: SessionParams,
        // The stored log as it is (JSON, every SDK message); Fastify sends a Buffer unserialised.
        response: { 200: z.unknown(), 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const session = await sessionOfRun(db, request.params.id, request.params.sessionId);
      if (!session) return sendError(reply, 404, ApiErrorCode.SessionNotFound, request.params);
      const blob = session.transcriptBlobKey
        ? await blobStore.get(session.transcriptBlobKey)
        : null;
      if (!blob) return sendError(reply, 404, ApiErrorCode.TranscriptNotFound, request.params);
      return reply.type(blob.contentType).send(Buffer.from(blob.body));
    },
  );
};

export default runs;
