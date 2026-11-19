// S-11-T2: approve the PR's sensitive files by hand (unsigned, "Approved by hand") or send them
// back to the author, signed and with a comment (FR-046). Both carry the sensitive version the
// person saw; a change since answers 409 `sensitive_stale`.
import { findPullRequest, lockActiveTeamMember, settleSensitiveFiles } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { buildSections, sectionsSchema } from '../../../pr-view/section.ts';
import { checklistSection, nextStepSection } from '../../../pr-view/sections/next-step.ts';
import { sensitiveSection } from '../../../pr-view/sections/sensitive.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...`, so not under the folder name. */
export const autoPrefix = '/api';

const Version = z.number().int().nonnegative();
const ApproveBody = z.object({ version: Version });
const SendBackBody = z.object({
  version: Version,
  comment: z.string().trim().max(2000).optional(),
  /** The signing Team member; checked by the api, so a missing one is `signature_required`. */
  signedBy: z.string().trim().optional(),
});

/** What changed on the PR page: the Next step, the checklist and the sensitive files. */
const RESULT_SECTIONS = [nextStepSection, checklistSection, sensitiveSection] as const;
export const SensitiveResult = sectionsSchema(RESULT_SECTIONS);

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

const sensitive: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  type Settle = Parameters<typeof settleSensitiveFiles>[1];
  type Outcome =
    Awaited<ReturnType<typeof settleSensitiveFiles>> | { ok: false; reason: 'signer_unknown' };

  async function answer(
    reply: Parameters<typeof sendError>[0],
    params: z.output<typeof PrParams>,
    settle: (pullRequestId: number) => Promise<Outcome>,
    signedBy?: string,
  ) {
    const found = await findPullRequest(db, params.repo, params.number);
    if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, params);
    const result = await settle(found.pullRequest.id);
    if (!result.ok) {
      switch (result.reason) {
        case 'signer_unknown':
          return sendError(reply, 400, ApiErrorCode.SignerUnknown, { signer: signedBy });
        case 'not_found':
          return sendError(reply, 404, ApiErrorCode.PrNotFound, params);
        case 'stale':
          return sendError(reply, 409, ApiErrorCode.SensitiveStale, { version: result.version });
        case 'nothing_to_settle':
          return sendError(reply, 409, ApiErrorCode.SensitiveNothingPending);
      }
    }
    const fresh = (await findPullRequest(db, params.repo, params.number))!;
    return buildSections(RESULT_SECTIONS, { db, ...fresh });
  }

  fastify.post(
    '/prs/:repo/:number/sensitive/approve',
    {
      schema: {
        params: PrParams,
        body: ApproveBody,
        response: { 200: SensitiveResult, ...errors },
      },
    },
    async (request, reply) =>
      answer(reply, request.params, (pullRequestId) =>
        settleSensitiveFiles(db, {
          pullRequestId,
          version: request.body.version,
          action: 'approve',
        } satisfies Settle),
      ),
  );

  fastify.post(
    '/prs/:repo/:number/sensitive/send-back',
    {
      schema: {
        params: PrParams,
        body: SendBackBody,
        response: { 200: SensitiveResult, ...errors },
      },
    },
    async (request, reply) => {
      const { version, comment, signedBy } = request.body;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      if (!comment) return sendError(reply, 400, ApiErrorCode.CommentRequired);
      return answer(
        reply,
        request.params,
        (pullRequestId) =>
          db.transaction(async (tx) => {
            // Locked, so the signer cannot be removed while the send back is written.
            const signer = await lockActiveTeamMember(tx, signedBy);
            if (!signer) return { ok: false, reason: 'signer_unknown' } as const;
            return settleSensitiveFiles(tx, {
              pullRequestId,
              version,
              action: 'send_back',
              memberId: signer.id,
              comment,
            });
          }),
        signedBy,
      );
    },
  );
};

export default sensitive;
