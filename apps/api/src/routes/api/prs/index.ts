import {
  findingsOf,
  findPullRequest,
  getRepositoryBySlug,
  latestRound,
  listOpenPullRequests,
  questionsOf,
  RUN_STATUSES,
} from '@pra/db';
import { SEVERITIES, VERDICTS } from '@pra/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { buildPrView, PrViewSchema } from '../../../pr-view/index.ts';
import { iso, roundLevel, RoundLevelSchema } from '../../../pr-view/round.ts';
import { RepositoryRefSchema } from '../../../pr-view/sections/pull-request.ts';

const PrParams = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

export const PrListResponse = z.object({
  pullRequests: z.array(
    z.object({
      repository: RepositoryRefSchema.pick({ slug: true }),
      number: z.number().int(),
      title: z.string(),
      authorLogin: z.string(),
      isDraft: z.boolean(),
      /** Status of the latest round; null before the first one. */
      latestRoundStatus: z.enum(RUN_STATUSES).nullable(),
    }),
  ),
});

export const FindingSchema = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  severity: z.enum(SEVERITIES),
  title: z.string(),
  file: z.string(),
  line: z.number().int().nullable(),
  scenario: z.string(),
  suggestion: z.string(),
  verdict: z.enum(VERDICTS),
  evidence: z.array(
    z.object({ file: z.string(), line: z.number().int().nullable(), quote: z.string() }),
  ),
});

export const QuestionSchema = z.object({
  id: z.number().int(),
  ordinal: z.number().int(),
  text: z.string(),
  options: z.array(z.string()),
  recommended: z.number().int().nullable(),
  why: z.string().nullable(),
});

export const FindingsResponse = z.object({
  /** The latest completed round the findings come from; null when no round completed yet. */
  round: z
    .object({
      id: z.number().int(),
      number: z.number().int().nullable(),
      level: RoundLevelSchema,
      finishedAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable(),
  findings: z.array(FindingSchema),
  questions: z.array(QuestionSchema),
  notChecked: z.array(z.string()),
});

/** Read endpoints for the PR list and the PR page. They never write. */
const prs: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get(
    '/',
    {
      schema: {
        querystring: z.object({ repo: z.string().min(1).optional() }),
        response: { 200: PrListResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      let repositoryId: number | undefined;
      if (request.query.repo !== undefined) {
        const repository = await getRepositoryBySlug(db, request.query.repo);
        if (!repository) {
          return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, {
            repo: request.query.repo,
          });
        }
        repositoryId = repository.id;
      }
      const rows = await listOpenPullRequests(db, { repositoryId });
      return {
        pullRequests: rows.map(({ repositorySlug, pullRequest, latestRoundStatus }) => ({
          repository: { slug: repositorySlug },
          number: pullRequest.number,
          title: pullRequest.title,
          authorLogin: pullRequest.authorLogin,
          isDraft: pullRequest.isDraft,
          latestRoundStatus,
        })),
      };
    },
  );

  fastify.get(
    '/:repo/:number',
    { schema: { params: PrParams, response: { 200: PrViewSchema, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      return buildPrView({ db, ...found });
    },
  );

  fastify.get(
    '/:repo/:number/findings',
    { schema: { params: PrParams, response: { 200: FindingsResponse, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);

      const run = await latestRound(db, found.pullRequest.id, { completed: true });
      if (!run) return { round: null, findings: [], questions: [], notChecked: [] };
      const [findings, questions] = await Promise.all([
        findingsOf(db, run.id),
        questionsOf(db, run.id),
      ]);
      return {
        round: {
          id: run.id,
          number: run.roundNo,
          level: roundLevel(run),
          finishedAt: iso(run.finishedAt),
        },
        findings: findings.map((f) => ({
          id: f.id,
          ordinal: f.ordinal,
          severity: f.severity,
          title: f.title,
          file: f.file,
          line: f.line,
          scenario: f.scenario,
          suggestion: f.suggestion,
          verdict: f.verdict,
          evidence: f.evidence,
        })),
        questions: questions.map((q) => ({
          id: q.id,
          ordinal: q.ordinal,
          text: q.text,
          options: q.options,
          recommended: q.recommended,
          why: q.why,
        })),
        notChecked: run.notChecked,
      };
    },
  );
};

export default prs;
