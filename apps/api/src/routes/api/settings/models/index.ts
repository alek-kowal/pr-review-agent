import {
  AGENT_ROLES,
  DEFAULT_MODELS,
  RoleModelsSchema,
  levelModelOverrides,
  type AgentRole,
} from '@pra/core';
import { getLevelOverrides, getRoleModels } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import { LevelSchema } from '../../../../settings/level-view.ts';
import {
  MODELS_ENTITY,
  modelsStore,
  type RoleModelSettings,
} from '../../../../settings/level-stores.ts';
import { applySignedSettingsChange } from '../../../../settings/signed-change.ts';

const RoleRecord = z.object(
  Object.fromEntries(AGENT_ROLES.map((role) => [role, z.string()])) as Record<
    AgentRole,
    z.ZodString
  >,
);

const ModelsResponse = z.object({
  /** The model of every role (Settings → Models). */
  models: RoleRecord,
  /** The defaults from tech-stack.md, offered in the model Select. */
  defaults: RoleRecord,
  /** Levels that set their own model for a role ("Level 6 uses claude-opus-5-5"). */
  overrides: z.array(
    z.object({ level: LevelSchema, role: z.enum(AGENT_ROLES), model: z.string() }),
  ),
});

const ModelsBody = z.object({
  /** Every role's model; a name that fails the model-name check is `invalid_model_name`. */
  models: RoleModelsSchema,
  /** The models the signer saw; when sent, a change made in between gives 409 `settings_stale`. */
  before: RoleRecord.optional(),
  signedBy: z.string().trim().optional(),
});

/** Settings → Models (S-21-T3, FR-075): the model of each agent role, signed. */
const models: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  const store = modelsStore();

  const read = async () => {
    const [roleModels, overrides] = await Promise.all([getRoleModels(db), getLevelOverrides(db)]);
    return {
      models: roleModels,
      defaults: { ...DEFAULT_MODELS },
      overrides: levelModelOverrides(overrides.value),
    };
  };

  fastify.get('/', { schema: { response: { 200: ModelsResponse } } }, read);

  fastify.put(
    '/',
    {
      schema: {
        body: ModelsBody,
        response: { 200: ModelsResponse, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { before, signedBy, models: after } = request.body;
      const result = await applySignedSettingsChange<RoleModelSettings>(db, {
        store,
        entity: MODELS_ENTITY,
        // Without `before` the stored value counts as seen: only `sameJson` reads it.
        before: before ?? (await getRoleModels(db)),
        after,
        signer: signedBy,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      return read();
    },
  );
};

export default models;
