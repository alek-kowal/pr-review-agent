import { FILE_STAGE_KEYS, type StageFileChoice } from '@pra/core';
import { getRepositoryBySlug, listInstructionFiles } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import { applySignedSettingsChange } from '../../../../settings/signed-change.ts';
import {
  filesAt,
  normalChoice,
  StageFileChoiceSchema,
  stageFileChoiceProblem,
  stageFilesEntity,
  stageFilesStore,
  StageFilesViewSchema,
} from '../../../../settings/stage-files.ts';
import { stageFilesAt } from '../../pipeline/index.ts';

const Params = z.object({ stage: z.enum(FILE_STAGE_KEYS) });

const Body = z.object({
  /** The repository's slug for its override; null for the global choice. */
  repository: z.string().trim().min(1).nullable(),
  /** The stored choice at this scope the signer saw (null when none); required, so a stale save is always refused. */
  before: StageFileChoiceSchema.nullable(),
  /** The choice to store; null (or one that sets nothing) goes back to inheriting. */
  after: StageFileChoiceSchema.nullable(),
  signedBy: z.string().trim().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

const Response = z.object({ stage: StageFilesViewSchema });

/**
 * Settings → Pipeline (STAGEFILES): one stage's instruction files at one scope, a signed change
 * logged in `settings_changes` (area `stage_files`). Runs that start afterwards read it.
 */
const stageFiles: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.put(
    '/:stage',
    {
      schema: {
        params: Params,
        body: Body,
        response: { 200: Response, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { stage } = request.params;
      const { repository: slug, signedBy, note } = request.body;
      const repository = slug ? await getRepositoryBySlug(db, slug) : null;
      if (slug && !repository) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { slug });
      }
      const repositoryId = repository?.id ?? null;
      const before = normalChoice(request.body.before as StageFileChoice | null);
      const after = normalChoice(request.body.after as StageFileChoice | null);

      const visible = filesAt(await listInstructionFiles(db), repositoryId);
      const problem = stageFileChoiceProblem(stage, before, after, visible);
      if (problem) return sendError(reply, 400, problem.code, problem.params);

      const result = await applySignedSettingsChange<StageFileChoice>(db, {
        store: stageFilesStore(),
        entity: stageFilesEntity(repositoryId, stage),
        before,
        after,
        signer: signedBy,
        note: note || null,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      const { views } = await stageFilesAt(db, repositoryId);
      return { stage: views.get(stage)! };
    },
  );
};

export default stageFiles;
