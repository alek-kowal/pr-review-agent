import type { AppSettings } from '@pra/core';
import { lockAppSettings, writeAppSettings } from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

/** The app settings Settings → Integrations edits. */
export type IntegrationSettings = Pick<AppSettings, 'afterRoundGithubComment'>;

/** The one entity of the area: the app settings row. */
export const INTEGRATIONS_ENTITY = 'app';

export const integrationSettingsOf = (settings: AppSettings): IntegrationSettings => ({
  afterRoundGithubComment: settings.afterRoundGithubComment,
});

/**
 * Integrations in Settings: only its own fields of the app settings, so a logged change shows
 * just them; the other app settings stay as they are.
 */
export function integrationsStore(): SettingsStore<IntegrationSettings> {
  return {
    area: 'integrations',
    async read(tx) {
      return integrationSettingsOf(await lockAppSettings(tx));
    },
    async write(tx, entity, after) {
      if (after === null) throw new Error('the integration settings cannot be removed');
      const current = await lockAppSettings(tx);
      const stored = await writeAppSettings(tx, { ...current, ...after });
      return { entity, value: integrationSettingsOf(stored) };
    },
  };
}
