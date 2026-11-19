// S-08-T1: answers to the reviewer's questions, all saved together under one signature (FR-034).
import { findPullRequest, lockActiveTeamMember, saveAnswers } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { answerView } from '../../../pr-view/findings.ts';
import { DecisionResult, refreshedView } from '../decisions/index.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...`, so not under the folder name. */
export const autoPrefix = '/api';

const AnswerBody = z.object({
  questionId: z.number().int().positive(),
  /** The picked option's index; leave out with `ownText`. */
  option: z.number().int().nonnegative().nullish(),
  ownText: z.string().trim().max(4000).nullish(),
  /** The answer the signer saw: its id, or null when the question was open. */
  expectedAnswerId: z.number().int().positive().nullable(),
});

const AnswersBody = z.object({
  answers: z.array(AnswerBody).min(1).max(50),
  /** The signing Team member; checked by the api, so a missing one is `signature_required`. */
  signedBy: z.string().trim().optional(),
});

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

const answersRoute: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/answers',
    {
      schema: {
        params: PrParams,
        body: AnswersBody,
        response: { 200: DecisionResult, ...errors },
      },
    },
    async (request, reply) => {
      const { signedBy } = request.body;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      const answers = request.body.answers.map((answer) => ({
        questionId: answer.questionId,
        option: answer.ownText ? null : (answer.option ?? null),
        ownText: answer.ownText ? answer.ownText : null,
        expectedAnswerId: answer.expectedAnswerId,
      }));
      // An own answer wins over a picked option, as on the page; one of them is needed.
      const empty = answers.filter((answer) => answer.option === null && !answer.ownText);
      if (empty.length > 0) {
        return sendError(reply, 400, ApiErrorCode.AnswerInvalid, {
          questionIds: empty.map((answer) => answer.questionId),
        });
      }
      const ids = answers.map((answer) => answer.questionId);
      if (new Set(ids).size !== ids.length) {
        return sendError(reply, 400, ApiErrorCode.AnswerInvalid, { questionIds: ids });
      }
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);

      const result = await db.transaction(async (tx) => {
        // Locked, so the signer cannot be removed while their answers are written.
        const signer = await lockActiveTeamMember(tx, signedBy);
        if (!signer) return { ok: false, reason: 'signer_unknown' } as const;
        return saveAnswers(tx, {
          pullRequestId: found.pullRequest.id,
          answers,
          signedBy: signer.id,
        });
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'signer_unknown':
            return sendError(reply, 400, ApiErrorCode.SignerUnknown, { signer: signedBy });
          case 'not_found':
            return sendError(reply, 404, ApiErrorCode.QuestionNotFound, {
              missing: result.missing,
            });
          case 'invalid_option':
            return sendError(reply, 400, ApiErrorCode.AnswerInvalid, {
              questionIds: result.questionIds,
            });
          case 'conflict':
            return sendError(reply, 409, ApiErrorCode.AnswerConflict, {
              conflicts: result.conflicts.map((conflict) => ({
                questionId: conflict.questionId,
                answer: conflict.current ? answerView(conflict.current) : null,
              })),
            });
        }
      }
      return refreshedView(db, found.pullRequest.id);
    },
  );
};

export default answersRoute;
