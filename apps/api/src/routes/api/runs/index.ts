// S-03-T6: Run detail and a session's full transcript. Reads only.
import { summarizeTranscript } from '@pra/agents/transcript';
import { chainState, roundLabel } from '@pra/core';
import {
  getRunContext,
  getRunDetail,
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
        /** The level of a level copy. */
        level: z.number().int().nullable().optional(),
        /** The instruction file, for a link to its editor; missing on runs before S-22. */
        fileId: z.number().int().nullable().optional(),
      }),
    ),
    /** The stage and error code a failed run stopped at. */
    error: z.object({ stage: z.string(), code: z.string() }).nullable(),
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
  const { db, blobStore } = fastify.deps;

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
      const chain = chainState((await runsOfPullRequest(db, run.pullRequestId)).map(runRecord));
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
