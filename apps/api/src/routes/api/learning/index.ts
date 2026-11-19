// Learning (S-23-T4, FR-083–086): lesson candidates the analyst proposed. Edit and "Try on a PR…"
// are unsigned ("by hand"); reject and accept are signed and go through the settings-change log.
// Accept adds the lesson to the repository's `lessons.md` as a new active version by the bot.
import { canAcceptLesson, MIN_PRS_FOR_LESSON } from '@pra/core';
import {
  editLessonCandidate,
  getLessonCandidate,
  lessonDraftOf,
  listLessonCandidates,
  type LessonCandidateView,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply } from 'fastify';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { learningStore, type LessonDecision } from '../../../settings/learning-store.ts';
import { applySignedSettingsChange } from '../../../settings/signed-change.ts';

const CandidateStatus = z.enum(['proposed', 'accepted', 'rejected']);

export const LessonCandidateSchema = z.object({
  id: z.number(),
  repo: z.string(),
  title: z.string(),
  text: z.string(),
  evidence: z.string(),
  status: CandidateStatus,
  prCount: z.number(),
  /** PRs a candidate needs before it can be accepted. */
  need: z.number(),
  sources: z.array(
    z.object({ repo: z.string(), number: z.number(), title: z.string(), evidence: z.string() }),
  ),
  rejectReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  /** The `lessons.md` version an accepted lesson went into. */
  lessonsVersion: z.number().nullable(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type LessonCandidateDto = z.infer<typeof LessonCandidateSchema>;

const ListResponse = z.object({ candidates: z.array(LessonCandidateSchema) });
const CandidateParams = z.object({ id: z.coerce.number().int().positive() });
const EditBody = z.object({ title: z.string().trim().min(1), text: z.string().trim().min(1) });
/** `text` is what the signer saw; a newer edit gives 409 `settings_stale`. */
const SignedBody = z.object({
  signedBy: z.string().trim().optional(),
  text: z.string().optional(),
});
const RejectBody = SignedBody.extend({ reason: z.string().trim().optional() });
const DraftResponse = z.object({ fileId: z.number(), versionId: z.number(), version: z.number() });

const errors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
} as const;

const learningRoutes: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get('/candidates', { schema: { response: { 200: ListResponse } } }, async () => ({
    candidates: (await listLessonCandidates(db)).map(toDto),
  }));

  fastify.put(
    '/candidates/:id',
    {
      schema: {
        params: CandidateParams,
        body: EditBody,
        response: { 200: LessonCandidateSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const candidate = await getLessonCandidate(db, id);
      if (!candidate) return notFound(reply, id);
      if (candidate.status !== 'proposed') return notOpen(reply, candidate);
      const edited = await editLessonCandidate(db, id, request.body);
      if (!edited) return notOpen(reply, (await getLessonCandidate(db, id))!);
      return toDto((await getLessonCandidate(db, id))!);
    },
  );

  fastify.post(
    '/candidates/:id/draft',
    { schema: { params: CandidateParams, response: { 201: DraftResponse, ...errors } } },
    async (request, reply) => {
      const { id } = request.params;
      const candidate = await getLessonCandidate(db, id);
      if (!candidate) return notFound(reply, id);
      if (candidate.status !== 'proposed') return notOpen(reply, candidate);
      const saved = await lessonDraftOf(db, id);
      if (!saved) return notOpen(reply, candidate);
      reply.code(201);
      return { fileId: saved.fileId, versionId: saved.draft.id, version: saved.draft.version };
    },
  );

  fastify.post(
    '/candidates/:id/reject',
    {
      schema: {
        params: CandidateParams,
        body: RejectBody,
        response: { 200: LessonCandidateSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const candidate = await getLessonCandidate(db, id);
      if (!candidate) return notFound(reply, id);
      if (candidate.status !== 'proposed') return notOpen(reply, candidate);
      const reason = request.body.reason;
      if (!reason) return sendError(reply, 400, ApiErrorCode.ReasonRequired);
      return decide(reply, candidate, request.body, { status: 'rejected', reason });
    },
  );

  fastify.post(
    '/candidates/:id/accept',
    {
      schema: {
        params: CandidateParams,
        body: SignedBody,
        response: { 200: LessonCandidateSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const candidate = await getLessonCandidate(db, id);
      if (!candidate) return notFound(reply, id);
      const check = canAcceptLesson({
        status: candidate.status as LessonDecision['status'],
        prs: candidate.sources.map((s) => s.pullRequestId),
      });
      if (!check.ok) {
        return sendError(reply, 409, check.reason.code as ApiErrorCode, check.reason.params);
      }
      return decide(reply, candidate, request.body, { status: 'accepted' });
    },
  );

  /** A signed reject or accept through the settings-change log. */
  async function decide(
    reply: FastifyReply,
    candidate: LessonCandidateView,
    body: z.infer<typeof SignedBody>,
    decision: Pick<LessonDecision, 'status' | 'reason'>,
  ) {
    const before: LessonDecision = {
      title: candidate.title,
      text: body.text ?? candidate.text,
      status: 'proposed',
    };
    const result = await applySignedSettingsChange(db, {
      store: learningStore(body.signedBy || null),
      entity: String(candidate.id),
      before,
      after: { title: candidate.title, text: candidate.text, ...decision },
      signer: body.signedBy,
      note: decision.reason ?? null,
    });
    if (!result.ok) return sendError(reply, result.status, result.code, result.params);
    return toDto((await getLessonCandidate(db, candidate.id))!);
  }
};

const notFound = (reply: FastifyReply, id: number) =>
  sendError(reply, 404, ApiErrorCode.LessonCandidateNotFound, { id });

const notOpen = (reply: FastifyReply, candidate: LessonCandidateView) =>
  sendError(reply, 409, ApiErrorCode.CandidateNotOpen, { status: candidate.status });

export function toDto(c: LessonCandidateView): LessonCandidateDto {
  return {
    id: c.id,
    repo: c.repositorySlug,
    title: c.title,
    text: c.text,
    evidence: c.evidence,
    status: c.status as LessonCandidateDto['status'],
    prCount: c.prCount,
    need: MIN_PRS_FOR_LESSON,
    sources: c.sources.map((s) => ({
      repo: s.repositorySlug,
      number: s.number,
      title: s.title,
      evidence: s.evidence,
    })),
    rejectReason: c.rejectReason,
    decidedBy: c.decidedByName,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    lessonsVersion: c.lessonsVersion,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export default learningRoutes;
