// S-21-T9: the settings store of Settings → Alerts. The alert config is one row, so the area has
// one entity.
import type { AlertConfig } from '@pra/core';
import { lockAlertConfig, writeAlertConfig } from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

export const ALERTS_ENTITY = 'config';

export function alertsStore(): SettingsStore<AlertConfig> {
  return {
    area: 'alerts',
    read: (tx) => lockAlertConfig(tx),
    async write(tx, entity, after) {
      if (after === null) throw new Error('the alert settings cannot be removed');
      return { entity, value: await writeAlertConfig(tx, after) };
    },
  };
}
