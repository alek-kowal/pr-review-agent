// S-13-T4: Implement with agent for findings already decided (signed), and the patch it leaves:
// read it with diffs, edit or revert a file, or revise it with a note. Patch writes are unsigned
// and recorded "by hand"; each edit or revert queues a patch check (reproductions only).
import { HAND, member, type Reason } from '@pra/core';
import {
  editPatchFile,
  findPullRequest,
  getPatch,
  lockActiveTeamMember,
  recordTimelineEntry,
  revertPatchFile,
  sendPatchCheckJob,
  startImplementer,
  type Db,
  type PatchFileChange,
  type Queue,
  type StartImplementerInput,
  type Transactor,
} from '@pra/db';
import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import {
  ApiErrorCode,
  ApiErrorSchema,
  sendError,
  type ApiErrorCode as Code,
} from '../../../plugins/errors.ts';
import { PatchDetailSchema, patchDetail } from '../../../pr-view/patch.ts';
import { PrParams } from '../prs/index.ts';

/** Routes sit under `/api/prs/...` and `/api/patches/...`, so not under the folder name. */
export const autoPrefix = '/api';

/** Core refusals of the implementer gate, as API errors. */
const REFUSALS: Record<string, { status: number; code: Code }> = {
  implement_below_level: { status: 409, code: ApiErrorCode.ImplementBelowLevel },
  fork_read_only: { status: 409, code: ApiErrorCode.ForkReadOnly },
  no_implement_decisions: { status: 409, code: ApiErrorCode.NoImplementDecisions },
  run_active: { status: 409, code: ApiErrorCode.RunActive },
  patch_stale: { status: 409, code: ApiErrorCode.PatchStale },
  pr_closed: { status: 409, code: ApiErrorCode.PrClosed },
  pr_not_found: { status: 404, code: ApiErrorCode.PrNotFound },
};

/** Sends the gate's refusal with its reason code and params. */
export function sendRefusal(reply: FastifyReply, refusal: Reason) {
  const known = REFUSALS[refusal.code] ?? { status: 409, code: ApiErrorCode.RunActive };
  return sendError(reply, known.status, known.code, refusal.params);
}

/** Thrown from a run's transaction to roll it back with an API error. */
export class RouteRefusal extends Error {
  readonly status: number;
  readonly code: Code;
  readonly params: Record<string, unknown>;
  constructor(status: number, code: Code, params: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

/** Starts the implementer; a `RouteRefusal` thrown by `prepare` comes back as `{ refusal }`. */
export async function startImplementerRun(
  deps: { db: Db; queue: Queue },
  input: StartImplementerInput,
) {
  try {
    return await startImplementer(deps, input);
  } catch (error) {
    if (error instanceof RouteRefusal) return { started: false as const, refusal: error };
    throw error;
  }
}

/**
 * Queues the patch check after an edit or a revert; a lost send leaves `checking` set, and the
 * worker's `resendLostJobs` sends it again.
 */
async function queueCheck(queue: Queue, log: FastifyBaseLogger, patchId: number) {
  await sendPatchCheckJob(queue, patchId).catch((error: unknown) =>
    log.warn({ err: error, patchId }, 'patch check job not sent'),
  );
}

export const ImplementResponse = z.object({
  runId: z.number().int(),
  findingIds: z.array(z.number().int()),
});

const PatchParams = z.object({ id: z.coerce.number().int().positive() });
const FileTarget = z.object({
  path: z.string().min(1).max(1000),
  /** The revision the person saw. */
  revision: z.number().int().positive(),
  /** The file's blob key the person saw. */
  blobKey: z.string().nullable(),
});

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

const patches: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, queue, blobStore } = fastify.deps;

  fastify.post(
    '/prs/:repo/:number/implement',
    {
      schema: {
        params: PrParams,
        body: z.object({ signedBy: z.string().trim().optional() }),
        response: { 202: ImplementResponse, ...errors },
      },
    },
    async (request, reply) => {
      const { signedBy } = request.body;
      if (!signedBy) return sendError(reply, 400, ApiErrorCode.SignatureRequired);
      const found = await findPullRequest(db, request.params.repo, request.params.number);
      if (!found) return sendError(reply, 404, ApiErrorCode.PrNotFound, request.params);
      const started = await startImplementerRun(
        { db, queue },
        {
          pullRequestId: found.pullRequest.id,
          startedBy: member(signedBy),
          prepare: async (tx) => {
            // Locked, so the signer cannot be removed while their run is created.
            if (!(await lockActiveTeamMember(tx, signedBy))) {
              throw new RouteRefusal(400, ApiErrorCode.SignerUnknown, { signer: signedBy });
            }
          },
        },
      );
      if (!started.started) {
        if ('refusal' in started) {
          const { status, code, params } = started.refusal;
          return sendError(reply, status, code, params);
        }
        return sendRefusal(reply, started.reason);
      }
      return reply.code(202).send({ runId: started.run.id, findingIds: started.findingIds });
    },
  );

  fastify.get(
    '/patches/:id',
    { schema: { params: PatchParams, response: { 200: PatchDetailSchema, 404: ApiErrorSchema } } },
    async (request, reply) => {
      const patch = await getPatch(db, request.params.id);
      if (!patch) return sendError(reply, 404, ApiErrorCode.PatchNotFound, request.params);
      return patchDetail(blobStore, patch);
    },
  );

  /** Edit and revert: one file change, its timeline entry by hand, then the patch check. */
  async function changeFile(
    reply: FastifyReply,
    log: FastifyBaseLogger,
    patchId: number,
    target: z.output<typeof FileTarget>,
    kind: 'patch_file_edited' | 'patch_file_reverted',
    change: (tx: Transactor) => Promise<PatchFileChange>,
  ) {
    const patch = await getPatch(db, patchId);
    if (!patch) return sendError(reply, 404, ApiErrorCode.PatchNotFound, { id: patchId });
    if (!patch.files.some((file) => file.path === target.path)) {
      return sendError(reply, 404, ApiErrorCode.PatchFileNotFound, { path: target.path });
    }
    const result = await db.transaction(async (tx) => {
      const changed = await change(tx);
      if (changed.ok) {
        await recordTimelineEntry(tx, {
          pullRequestId: patch.pullRequestId,
          actor: HAND,
          kind,
          params: { revision: patch.revision, path: target.path },
          sourceKey: `patch:${patchId}:${kind}:${randomUUID()}`,
        });
      }
      return changed;
    });
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return sendError(reply, 404, ApiErrorCode.PatchFileNotFound, { path: target.path });
      }
      if (result.reason === 'revising') {
        return sendError(reply, 409, ApiErrorCode.RunActive, {
          kind: 'implementer',
          status: result.status,
        });
      }
      return sendError(reply, 409, ApiErrorCode.PatchStale, { revision: result.revision });
    }
    await queueCheck(queue, log, patchId);
    return patchDetail(blobStore, (await getPatch(db, patchId))!);
  }

  fastify.put(
    '/patches/:id/files',
    {
      schema: {
        params: PatchParams,
        body: FileTarget.extend({ content: z.string().max(1_000_000) }),
        response: { 200: PatchDetailSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { content, ...target } = request.body;
      const blobKey = `patches/${id}/edit-${randomUUID()}.txt`;
      await blobStore.put(blobKey, content, { contentType: 'text/plain; charset=utf-8' });
      return changeFile(reply, request.log, id, target, 'patch_file_edited', (tx) =>
        editPatchFile(tx, {
          patchId: id,
          revision: target.revision,
          path: target.path,
          expectedBlobKey: target.blobKey,
          blobKey,
        }),
      );
    },
  );

  fastify.post(
    '/patches/:id/files/revert',
    {
      schema: {
        params: PatchParams,
        body: FileTarget,
        response: { 200: PatchDetailSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const target = request.body;
      return changeFile(reply, request.log, id, target, 'patch_file_reverted', (tx) =>
        revertPatchFile(tx, {
          patchId: id,
          revision: target.revision,
          path: target.path,
          expectedBlobKey: target.blobKey,
        }),
      );
    },
  );

  fastify.post(
    '/patches/:id/revise',
    {
      schema: {
        params: PatchParams,
        body: z.object({ note: z.string().max(4000).optional() }),
        response: { 202: ImplementResponse, ...errors },
      },
    },
    async (request, reply) => {
      const note = request.body.note?.trim();
      if (!note) return sendError(reply, 400, ApiErrorCode.NoteRequired);
      const patch = await getPatch(db, request.params.id);
      if (!patch) return sendError(reply, 404, ApiErrorCode.PatchNotFound, request.params);
      const started = await startImplementerRun(
        { db, queue },
        {
          pullRequestId: patch.pullRequestId,
          startedBy: HAND,
          revise: { patchId: patch.id, note },
          prepare: async (tx) => {
            await recordTimelineEntry(tx, {
              pullRequestId: patch.pullRequestId,
              actor: HAND,
              kind: 'patch_revise_requested',
              params: { revision: patch.revision, note },
              sourceKey: `patch:${patch.id}:revise:${randomUUID()}`,
            });
          },
        },
      );
      if (!started.started) {
        if ('refusal' in started) {
          const { status, code, params } = started.refusal;
          return sendError(reply, status, code, params);
        }
        return sendRefusal(reply, started.reason);
      }
      return reply.code(202).send({ runId: started.run.id, findingIds: started.findingIds });
    },
  );
};

export default patches;
