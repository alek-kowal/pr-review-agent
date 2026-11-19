import { checklist, DECISIONS, member, nextStep } from '@pra/core';
import {
  decideFindings,
  startImplementer,
  type DecideFindingsResult,
  type Transactor,
  FOLLOW_UP_DELAY_SECONDS,
  findPullRequest,
  getDecisionBatch,
  loadPrStateInput,
  JOBS,
  lockActiveTeamMember,
  prAuthor,
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
import { sendRefusal } from '../patches/index.ts';
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
  /** Implement only: the same signature also starts the implementer (FR-047). */
  withAgent: z.boolean().optional(),
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
  /** The implementer run a decision `withAgent` started. */
  implementerRunId: z.number().int().nullable(),
});

/** A decision the transaction refused; thrown so a `withAgent` run rolls back with it. */
class DecisionRefused extends Error {
  readonly result:
    Exclude<DecideFindingsResult, { ok: true }> | { ok: false; reason: 'signer_unknown' };
  constructor(result: DecisionRefused['result']) {
    super(result.reason);
    this.result = result;
  }
}

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

/** The Next step, checklist and Findings tab as they are now (also after answers and reviews). */
export async function refreshedView(db: Executor, pullRequestId: number) {
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
      const { findingIds, decision, reason, signedBy, expectedVersions, withAgent } = request.body;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      if (decision === 'reject' && !reason) {
        return sendError(reply, 400, ApiErrorCode.ReasonRequired);
      }
      if (withAgent && decision !== 'implement') {
        return sendError(reply, 400, ApiErrorCode.WithAgentNeedsImplement);
      }
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);

      const versions = Object.fromEntries(
        Object.entries(expectedVersions).map(([id, version]) => [Number(id), version]),
      );
      const decideIn = async (tx: Executor & Transactor) => {
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
      };

      let result: Awaited<ReturnType<typeof decideIn>>;
      let implementerRunId: number | null = null;
      if (withAgent) {
        // One signature: the decisions and the implementer run commit together or not at all.
        let decided: Awaited<ReturnType<typeof decideIn>> | undefined;
        try {
          const started = await startImplementer(
            { db, queue },
            {
              pullRequestId: found.pullRequest.id,
              startedBy: member(signedBy),
              prepare: async (tx) => {
                decided = await decideIn(tx);
                if (!decided.ok) throw new DecisionRefused(decided);
              },
            },
          );
          if (!started.started) return sendRefusal(reply, started.reason);
          implementerRunId = started.run.id;
          result = decided!;
        } catch (error) {
          if (!(error instanceof DecisionRefused)) throw error;
          result = error.result;
        }
      } else {
        result = await db.transaction((tx) => decideIn(tx));
      }

      if (!result.ok) {
        switch (result.reason) {
          case 'signer_unknown':
            return sendError(reply, 400, ApiErrorCode.SignerUnknown, { signer: signedBy });
          case 'not_found':
            return sendError(reply, 404, ApiErrorCode.FindingNotFound, {
              missing: result.missing,
            });
          case 'conflict': {
            const author = await prAuthor(db, found.pullRequest.id);
            return sendError(reply, 409, ApiErrorCode.DecisionConflict, {
              conflicts: result.conflicts.map((conflict) => ({
                findingId: conflict.findingId,
                version: conflict.version,
                decision: conflict.current ? decisionView(conflict.current, author) : null,
              })),
            });
          }
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
      return {
        batchId: result.batch.id,
        implementerRunId,
        ...(await refreshedView(db, found.pullRequest.id)),
      };
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
