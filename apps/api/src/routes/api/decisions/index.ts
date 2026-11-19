import { checklist, DECISIONS, nextStep } from '@pra/core';
import {
  decideFindings,
  FOLLOW_UP_DELAY_SECONDS,
  findPullRequest,
  getDecisionBatch,
  loadPrStateInput,
  JOBS,
  lockActiveTeamMember,
  sendJob,
  undoDecisionBatch,
  type Executor,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { decisionView, FindingsResponse, loadFindingsView } from '../../../pr-view/findings.ts';
import {
  ChecklistSchema,
  checklistView,
  NextStepSchema,
  nextStepView,
} from '../../../pr-view/state.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...` and `/api/decision-batches/...`, so not under the folder name. */
export const autoPrefix = '/api';

const DecideBody = z.object({
  findingIds: z.array(z.number().int().positive()).min(1).max(200),
  decision: z.enum(DECISIONS),
  /** Required for Reject. */
  reason: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((reason) => (reason ? reason : null)),
  /** The signing Team member; checked by the api, so a missing one is `signature_required`. */
  signedBy: z.string().trim().optional(),
  /** The version of each finding the signer saw, by finding id. */
  expectedVersions: z.record(z.string(), z.number().int().nonnegative()),
});

/** The PR view after a decision or an undo: what changed on the PR page and the board. */
export const DecisionResult = z.object({
  nextStep: NextStepSchema,
  checklist: ChecklistSchema,
  findings: FindingsResponse,
});
export const DecideResponse = DecisionResult.extend({
  /** The batch the decision wrote; Undo takes this id. */
  batchId: z.number().int(),
});

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

async function refreshedView(db: Executor, pullRequestId: number) {
  const load = await loadPrStateInput(db, pullRequestId);
  if (!load) throw new Error(`pull request ${pullRequestId} disappeared`);
  return {
    nextStep: nextStepView(nextStep(load.input)),
    checklist: checklistView(checklist(load.input)),
    findings: await loadFindingsView(db, load),
  };
}

/**
 * Signed decisions on findings (FR-040): one signature decides one or many findings in one batch,
 * and Undo takes the batch back while none of its findings changed since. A decision only records;
 * nothing is written to GitHub.
 */
const decisions: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, queue } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/decisions',
    {
      schema: { params: PrParams, body: DecideBody, response: { 200: DecideResponse, ...errors } },
    },
    async (request, reply) => {
      const { findingIds, decision, reason, signedBy, expectedVersions } = request.body;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      if (decision === 'reject' && !reason) {
        return sendError(reply, 400, ApiErrorCode.ReasonRequired);
      }
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);

      const versions = Object.fromEntries(
        Object.entries(expectedVersions).map(([id, version]) => [Number(id), version]),
      );
      const result = await db.transaction(async (tx) => {
        // Locked, so the signer cannot be removed while their decision is written.
        const signer = await lockActiveTeamMember(tx, signedBy);
        if (!signer) return { ok: false, reason: 'signer_unknown' } as const;
        return decideFindings(tx, {
          pullRequestId: found.pullRequest.id,
          findingIds,
          expectedVersions: versions,
          decision,
          reason,
          signedBy: signer.id,
        });
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'signer_unknown':
            return sendError(reply, 400, ApiErrorCode.SignerUnknown, { signer: signedBy });
          case 'not_found':
            return sendError(reply, 404, ApiErrorCode.FindingNotFound, {
              missing: result.missing,
            });
          case 'conflict':
            return sendError(reply, 409, ApiErrorCode.DecisionConflict, {
              conflicts: result.conflicts.map((conflict) => ({
                findingId: conflict.findingId,
                version: conflict.version,
                decision: conflict.current ? decisionView(conflict.current) : null,
              })),
            });
        }
      }
      if (decision === 'defer') {
        // ClickUp follow-up tasks (S-06-T5), after the Undo window. A lost send is resent by the
        // worker (`resendLostFollowUps`), so the decision stands either way.
        await sendJob(
          queue,
          JOBS.clickupFollowUp,
          { batchId: result.batch.id },
          { singletonKey: `${result.batch.id}`, startAfter: FOLLOW_UP_DELAY_SECONDS },
        ).catch((error: unknown) =>
          request.log.warn({ err: error, batchId: result.batch.id }, 'follow-up job not sent'),
        );
      }
      return { batchId: result.batch.id, ...(await refreshedView(db, found.pullRequest.id)) };
    },
  );

  fastify.post(
    '/decision-batches/:id/undo',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: DecisionResult, ...errors },
      },
    },
    async (request, reply) => {
      const batch = await getDecisionBatch(db, request.params.id);
      if (!batch) return sendError(reply, 404, ApiErrorCode.DecisionBatchNotFound, request.params);
      const result = await undoDecisionBatch(db, batch.id);
      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            return sendError(reply, 404, ApiErrorCode.DecisionBatchNotFound, request.params);
          case 'already_undone':
            return sendError(reply, 409, ApiErrorCode.DecisionAlreadyUndone, request.params);
          case 'changed_since':
            return sendError(reply, 409, ApiErrorCode.DecisionChangedSince, {
              findingIds: result.findingIds,
            });
        }
      }
      return refreshedView(db, batch.pullRequestId);
    },
  );
};

export default decisions;
