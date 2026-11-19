import { getAppSettings } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import {
  DEFAULT_LEVEL_ENTITY,
  defaultLevelStore,
  type DefaultLevelSetting,
} from '../../../../settings/level-stores.ts';
import { LevelSchema } from '../../../../settings/level-view.ts';
import { applySignedSettingsChange } from '../../../../settings/signed-change.ts';

const DefaultLevelBody = z.object({
  /** The level of repositories without their own default level. */
  defaultLevel: LevelSchema,
  /** The default the signer saw; a change made in between gives 409 `settings_stale`. */
  before: z.object({ defaultLevel: LevelSchema }).optional(),
  signedBy: z.string().trim().optional(),
});
const DefaultLevelResponse = z.object({ defaultLevel: LevelSchema });

/** Settings → Review levels: the global default level (S-21-T3), signed. */
const defaultLevel: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  const store = defaultLevelStore();

  fastify.put(
    '/',
    {
      schema: {
        body: DefaultLevelBody,
        response: { 200: DefaultLevelResponse, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { before, signedBy, defaultLevel: level } = request.body;
      const result = await applySignedSettingsChange<DefaultLevelSetting>(db, {
        store,
        entity: DEFAULT_LEVEL_ENTITY,
        before: before ?? { defaultLevel: (await getAppSettings(db)).value.defaultLevel },
        after: { defaultLevel: level },
        signer: signedBy,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      return { defaultLevel: result.value!.defaultLevel };
    },
  );
};

export default defaultLevel;
