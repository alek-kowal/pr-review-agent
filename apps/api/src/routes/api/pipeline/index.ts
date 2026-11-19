import { PIPELINE_STAGE_KEYS, PIPELINE_STAGES } from '@pra/agents';
import { AGENT_ROLES, LEVEL_NUMBERS, modelFor, resolveLevel } from '@pra/core';
import { getLevelOverrides, getRoleModels, listInstructionFiles } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

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
  /** The global files the stage reads, with the active version (null when none is active). */
  instructions: z.array(
    z.object({
      fileKey: z.string(),
      fileId: z.number().int().nullable(),
      version: z.number().int().nullable(),
    }),
  ),
  output: z.object({ schema: z.string(), fields: z.array(z.string()) }),
  timeoutMinutes: z.number().int(),
  attempts: z.number().int(),
  repairs: z.number().int(),
  onFrom: z.union(LEVEL_NUMBERS.map((n) => z.literal(n))),
});

export const PipelineResponse = z.object({ stages: z.array(StageSchema) });

/**
 * The read-only pipeline (S-22-T9, FR-081): each stage's model from the resolver the worker uses
 * (at the level where the stage turns on), its tools, its global instruction files and versions,
 * its output, timeout and attempts.
 */
const pipelineRoutes: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get('/', { schema: { response: { 200: PipelineResponse } } }, async () => {
    const [overrides, roleModels, files] = await Promise.all([
      getLevelOverrides(db),
      getRoleModels(db),
      listInstructionFiles(db),
    ]);
    const global = new Map(
      files.filter((f) => f.scope === 'global').map((f) => [f.fileKey, f] as const),
    );
    return {
      stages: PIPELINE_STAGES.map((stage) => {
        // Settings → Models and Review levels (S-21), the same sources a new run snapshots.
        const level = resolveLevel(stage.onFrom, overrides.value);
        return {
          key: stage.key,
          role: stage.role,
          model: stage.role ? modelFor(roleModels, level, stage.role) : null,
          tools: [...stage.tools],
          integrations: [...stage.integrations],
          instructions: stage.instructionFiles.map((fileKey) => {
            const file = global.get(fileKey);
            return {
              fileKey,
              fileId: file?.id ?? null,
              version: file?.active?.version ?? null,
            };
          }),
          output: { schema: stage.output.schema, fields: [...stage.output.fields] },
          timeoutMinutes: level.settings.stageTimeoutMinutes,
          attempts: stage.attempts,
          repairs: stage.repairs,
          onFrom: stage.onFrom,
        };
      }),
    };
  });
};

export default pipelineRoutes;
