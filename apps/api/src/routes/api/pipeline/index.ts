import { PIPELINE_STAGE_KEYS, PIPELINE_STAGES } from '@pra/agents';
import {
  AGENT_ROLES,
  isFileStageKey,
  LEVEL_NUMBERS,
  modelFor,
  resolveLevel,
  type FileStageKey,
} from '@pra/core';
import {
  getLevelOverrides,
  getRepositoryBySlug,
  getRoleModels,
  listInstructionFiles,
  listRepositories,
  stageFileChoicesOf,
  type Executor,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import {
  FileOptionSchema,
  fileOptions,
  StageFilesViewSchema,
  stageFilesView,
  type StageFilesView,
} from '../../../settings/stage-files.ts';

const RepositoryRefSchema = z.object({ id: z.number().int(), slug: z.string() });

const StageSchema = z.object({
  key: z.enum(PIPELINE_STAGE_KEYS),
  role: z.enum(AGENT_ROLES).nullable(),
  /** Null for a stage of plain code. */
  model: z
    .object({
      model: z.string(),
      source: z.enum(['level', 'settings', 'default']),
      level: z.number().int().nullable(),
    })
    .nullable(),
  tools: z.array(z.string()),
  integrations: z.array(z.string()),
  /** The instruction files the stage reads at this scope, by slot; null when it reads none. */
  files: StageFilesViewSchema.nullable(),
  output: z.object({ schema: z.string(), fields: z.array(z.string()) }),
  timeoutMinutes: z.number().int(),
  attempts: z.number().int(),
  repairs: z.number().int(),
  onFrom: z.union(LEVEL_NUMBERS.map((n) => z.literal(n))),
});

export const PipelineResponse = z.object({
  /** The scope the stage files are shown for: Global, or one repository. */
  scope: z.object({ repository: RepositoryRefSchema.nullable() }),
  /** Connected repositories, for the scope picker. */
  repositories: z.array(RepositoryRefSchema),
  /** The files a slot can pick at this scope, by kind. */
  options: z.object({
    instruction: z.array(FileOptionSchema),
    document: z.array(FileOptionSchema),
  }),
  stages: z.array(StageSchema),
});

const PipelineQuery = z.object({ repository: z.string().trim().min(1).optional() });

/** The stage files of every stage that reads files, at one scope, with the scope's options. */
export async function stageFilesAt(db: Executor, repositoryId: number | null) {
  const [files, choices] = await Promise.all([
    listInstructionFiles(db),
    stageFileChoicesOf(db, repositoryId),
  ]);
  const views = new Map<FileStageKey, StageFilesView>();
  for (const stage of PIPELINE_STAGES) {
    if (!stage.slots.length || !isFileStageKey(stage.key)) continue;
    views.set(stage.key, stageFilesView(stage.key, choices, files, repositoryId));
  }
  return {
    files,
    views,
    options: {
      instruction: fileOptions(files, repositoryId, 'instruction'),
      document: fileOptions(files, repositoryId, 'document'),
    },
  };
}

/**
 * The pipeline (S-22-T9, FR-081): each stage's model from the resolver the worker uses (at the
 * level where the stage turns on), its tools, its output, timeout and attempts, and (STAGEFILES)
 * the instruction files each slot reads at the chosen scope.
 */
const pipelineRoutes: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get(
    '/',
    {
      schema: {
        querystring: PipelineQuery,
        response: { 200: PipelineResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const slug = request.query.repository;
      const repository = slug ? await getRepositoryBySlug(db, slug) : null;
      if (slug && !repository) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { slug });
      }
      const [overrides, roleModels, repositories, scoped] = await Promise.all([
        getLevelOverrides(db),
        getRoleModels(db),
        listRepositories(db),
        stageFilesAt(db, repository?.id ?? null),
      ]);
      return {
        scope: { repository: repository && { id: repository.id, slug: repository.slug } },
        repositories: repositories.map((r) => ({ id: r.id, slug: r.slug })),
        options: scoped.options,
        stages: PIPELINE_STAGES.map((stage) => {
          // Settings → Models and Review levels (S-21), the same sources a new run snapshots.
          const level = resolveLevel(stage.onFrom, overrides.value);
          return {
            key: stage.key,
            role: stage.role,
            model: stage.role ? modelFor(roleModels, level, stage.role) : null,
            tools: [...stage.tools],
            integrations: [...stage.integrations],
            files: isFileStageKey(stage.key) ? (scoped.views.get(stage.key) ?? null) : null,
            output: { schema: stage.output.schema, fields: [...stage.output.fields] },
            timeoutMinutes: level.settings.stageTimeoutMinutes,
            attempts: stage.attempts,
            repairs: stage.repairs,
            onFrom: stage.onFrom,
          };
        }),
      };
    },
  );
};

export default pipelineRoutes;
