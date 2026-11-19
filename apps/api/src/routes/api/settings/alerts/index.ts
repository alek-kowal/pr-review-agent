// S-21-T9 (FR-067): Settings → Alerts. Which alerts are on, their thresholds and the general
// alerts task, changed by a signed write (one `settings_changes` row, area `alerts`). Alerts only
// report; nothing here stops a round.
import { AlertConfigSchema, AlertConfigWriteSchema, type AlertConfig } from '@pra/core';
import { getAlertConfig } from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import { ALERTS_ENTITY, alertsStore } from '../../../../settings/alerts-store.ts';
import { applySignedSettingsChange } from '../../../../settings/signed-change.ts';

export const AlertSettingsResponse = z.object({ config: AlertConfigSchema });

export const AlertSettingsBody = z.object({
  /** Cost above 0, budget at 50, 70, 80 or 90%, and the general alerts task (required here). */
  config: AlertConfigWriteSchema,
  /** The settings the signer saw; a change made in between gives 409 `settings_stale`. */
  before: AlertConfigSchema.optional(),
  signedBy: z.string().trim().optional(),
});

const alerts: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;
  const store = alertsStore();

  fastify.get('/', { schema: { response: { 200: AlertSettingsResponse } } }, async () => ({
    config: await getAlertConfig(db),
  }));

  fastify.put(
    '/',
    {
      schema: {
        body: AlertSettingsBody,
        response: { 200: AlertSettingsResponse, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { before, signedBy, config } = request.body;
      const result = await applySignedSettingsChange<AlertConfig>(db, {
        store,
        entity: ALERTS_ENTITY,
        // Without `before` the stored value counts as seen.
        before: before ?? (await getAlertConfig(db)),
        after: config,
        signer: signedBy,
      });
      if (!result.ok) return sendError(reply, result.status, result.code, result.params);
      return { config: result.value! };
    },
  );
};

export default alerts;
