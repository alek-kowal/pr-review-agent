import {
  FEATURE_ON_FROM,
  LEVEL_NUMBERS,
  type LevelNumber,
  type LevelSettingsPatch,
} from '@pra/core';
import { getAppSettings, getLevelOverrides, getRoleModels } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import { levelStore } from '../../../../settings/level-stores.ts';
import {
  LevelSchema,
  LevelValuesSchema,
  LevelViewSchema,
  levelView,
  ownValuesOf,
} from '../../../../settings/level-view.ts';
import { applySignedSettingsChange } from '../../../../settings/signed-change.ts';

const LevelsResponse = z.object({
  /** The level of repositories without their own default level. */
  defaultLevel: LevelSchema,
  levels: z.array(LevelViewSchema),
});
const LevelResponse = z.object({ defaultLevel: LevelSchema, level: LevelViewSchema });

const LevelParams = z.object({
  n: z.coerce
    .number()
    .int()
    .refine((n) => (LEVEL_NUMBERS as readonly number[]).includes(n), { message: 'level_unknown' }),
});

const LevelBody = z.object({
  values: LevelValuesSchema,
  /** The level's own values the signer saw; a change made in between gives 409. */
  before: z.record(z.string(), z.unknown()).optional(),
  signedBy: z.string().trim().optional(),
});

/**
 * Settings → Review levels (S-21-T3, FR-078): the 1–6 ladder, each level's settings inherited
 * from the level below, and signed own values per level.
 */
const levels: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  const store = levelStore();

  const load = async () => {
    const [overrides, roleModels, app] = await Promise.all([
      getLevelOverrides(db),
      getRoleModels(db),
      getAppSettings(db),
    ]);
    return { overrides: overrides.value, roleModels, defaultLevel: app.value.defaultLevel };
  };

  fastify.get('/', { schema: { response: { 200: LevelsResponse } } }, async () => {
    const { overrides, roleModels, defaultLevel } = await load();
    return { defaultLevel, levels: LEVEL_NUMBERS.map((n) => levelView(n, overrides, roleModels)) };
  });

  const oneLevel = async (n: LevelNumber) => {
    const { overrides, roleModels, defaultLevel } = await load();
    return { defaultLevel, level: levelView(n, overrides, roleModels) };
  };

  fastify.get(
    '/:n',
    { schema: { params: LevelParams, response: { 200: LevelResponse } } },
    async (request) => oneLevel(request.params.n as LevelNumber),
  );

  fastify.put(
    '/:n',
    {
      schema: {
        params: LevelParams,
        body: LevelBody,
        response: { 200: LevelResponse, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const n = request.params.n as LevelNumber;
      const { values, before, signedBy } = request.body;
      // Automatic patches exist only from level 5, where autofix starts.
      if (values.autofixMaxPatches !== undefined && values.autofixMaxPatches !== 'inherit') {
        if (n < FEATURE_ON_FROM.autofix) {
          return sendError(reply, 400, ApiErrorCode.InvalidRequest, {
            part: 'body',
            issues: [{ path: '/values/autofixMaxPatches', code: 'not_at_this_level' }],
          });
        }
      }
      const result = await applySignedSettingsChange<LevelSettingsPatch>(db, {
        store,
        entity: String(n),
        before: (before as LevelSettingsPatch | undefined) ?? (await load()).overrides[n] ?? {},
        after: ownValuesOf(values),
        signer: signedBy,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      return oneLevel(n);
    },
  );
};

export default levels;
