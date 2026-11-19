import { compareFindings, HAND, SEVERITIES, VERDICTS } from '@pra/core';
import {
  activeVersionOf,
  findingsOf,
  getInstructionVersion,
  getPullRequest,
  getRepositoryBySlug,
  getTrialSummary,
  listTrials,
  sessionCostsOfRuns,
  startTrial,
  versionsOfRun,
  type FindingRow,
  type TrialSummary,
} from '@pra/db';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';

const TRIAL_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const;

export const TrialSummarySchema = z.object({
  id: z.number().int(),
  pr: z.object({ repo: z.string(), number: z.number().int(), title: z.string() }),
  /** The draft run B read; `status` is the version's status now (it may be active since). */
  draft: z.object({
    id: z.number().int(),
    fileId: z.number().int(),
    fileKey: z.string(),
    version: z.number().int(),
    status: z.string(),
  }),
  /** Both runs together: running until both finish, failed or cancelled when one did. */
  status: z.enum(TRIAL_STATUSES),
  /** `hand`: a trial starts unsigned. */
  startedBy: z.enum(['member', 'bot', 'hand']),
  headSha: z.string(),
  createdAt: z.string(),
});

const FindingSchema = z.object({
  id: z.number().int(),
  severity: z.enum(SEVERITIES),
  title: z.string(),
  file: z.string(),
  line: z.number().int().nullable(),
  verdict: z.enum(VERDICTS),
});

const RunSideSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  /** The cost of this run's agent sessions only. */
  costUsd: z.number(),
});

export const TrialsListResponse = z.object({ trials: z.array(TrialSummarySchema) });

export const TrialDetailResponse = z.object({
  trial: TrialSummarySchema.extend({
    runs: z.object({ a: RunSideSchema.nullable(), b: RunSideSchema.nullable() }),
    /** Findings split by core `compareFindings`. */
    compare: z.object({
      onlyA: z.array(FindingSchema),
      onlyB: z.array(FindingSchema),
      both: z.array(z.object({ a: FindingSchema, b: FindingSchema })),
    }),
    /** The draft against the version of its file run A read. */
    diff: z.object({
      fileKey: z.string(),
      before: z.object({ version: z.number().int(), content: z.string() }).nullable(),
      after: z.object({ version: z.number().int(), content: z.string() }),
    }),
  }),
});

const StartBody = z.object({
  pr: z.object({ repo: z.string().trim().min(1), number: z.number().int().positive() }),
  /** The draft version run B reads. */
  instructionDraft: z.number().int().positive(),
});
const TrialParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * Trials (S-22-T7, FR-080): run a draft against the active instructions on one PR commit. A start
 * is unsigned ("Started by hand"); the two runs never change the PR.
 */
const trialsRoutes: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, queue } = fastify.deps;

  fastify.get('/', { schema: { response: { 200: TrialsListResponse } } }, async () => ({
    trials: (await listTrials(db)).map(summaryView),
  }));

  fastify.post(
    '/',
    {
      schema: {
        body: StartBody,
        response: {
          201: TrialDetailResponse,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { pr, instructionDraft } = request.body;
      const repository = await getRepositoryBySlug(db, pr.repo);
      const pullRequest = repository && (await getPullRequest(db, repository.id, pr.number));
      if (!pullRequest) return sendError(reply, 404, ApiErrorCode.PrNotFound, pr);
      const started = await startTrial(
        { db, queue, logger: request.log },
        { pullRequestId: pullRequest.id, draftVersionId: instructionDraft, startedBy: HAND },
      );
      if (!started.started) {
        return sendError(reply, 409, ApiErrorCode.TrialNeedsDraft, started.reason.params);
      }
      reply.code(201);
      return detail(reply, started.trial.id);
    },
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: TrialParams,
        response: { 200: TrialDetailResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => detail(reply, request.params.id),
  );

  async function detail(reply: FastifyReply, id: number) {
    const trial = await getTrialSummary(db, id);
    if (!trial) return sendError(reply, 404, ApiErrorCode.TrialNotFound, { id });
    const runIds = [trial.runAId, trial.runBId].filter((r): r is number => r !== null);
    const costs = await sessionCostsOfRuns(db, runIds);
    const side = (runId: number | null, status: string | null) =>
      runId === null ? null : { id: runId, status: status ?? 'queued', costUsd: costs.get(runId)! };
    const [a, b] = await Promise.all([
      trial.runAId ? findingsOf(db, trial.runAId) : [],
      trial.runBId ? findingsOf(db, trial.runBId) : [],
    ]);
    const compared = compareFindings(a, b);
    return {
      trial: {
        ...summaryView(trial),
        runs: { a: side(trial.runAId, trial.runAStatus), b: side(trial.runBId, trial.runBStatus) },
        compare: {
          onlyA: compared.onlyA.map(findingView),
          onlyB: compared.onlyB.map(findingView),
          both: compared.both.map((pair) => ({ a: findingView(pair.a), b: findingView(pair.b) })),
        },
        diff: await instructionDiff(trial),
      },
    };
  }

  /** The draft against the same file's version run A read, or its active one before A started. */
  async function instructionDiff(trial: TrialSummary) {
    const draft = (await getInstructionVersion(db, trial.draft.id))!;
    const read = trial.runAId ? await versionsOfRun(db, trial.runAId) : [];
    const before =
      read.find((v) => v.fileId === draft.fileId) ??
      read.find((v) => v.fileKey === draft.fileKey) ??
      (read.length ? null : await activeVersionOf(db, draft.fileId));
    return {
      fileKey: draft.fileKey,
      before: before && { version: before.version, content: before.content },
      after: { version: draft.version, content: draft.content },
    };
  }
};

function trialStatus(a: string | null, b: string | null): (typeof TRIAL_STATUSES)[number] {
  const both = [a, b];
  if (both.includes('failed')) return 'failed';
  if (both.includes('cancelled')) return 'cancelled';
  if (both.every((s) => s === 'completed')) return 'completed';
  return 'running';
}

function summaryView(trial: TrialSummary) {
  return {
    id: trial.id,
    pr: { repo: trial.repositorySlug, number: trial.prNumber, title: trial.prTitle },
    draft: trial.draft,
    status: trialStatus(trial.runAStatus, trial.runBStatus),
    startedBy: trial.startedBy,
    headSha: trial.headSha,
    createdAt: trial.createdAt.toISOString(),
  };
}

function findingView(finding: FindingRow) {
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    file: finding.file,
    line: finding.line,
    verdict: finding.verdict,
  };
}

export default trialsRoutes;
