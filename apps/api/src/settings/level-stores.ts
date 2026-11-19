// S-21-T3: the settings stores of Settings → Models and Review levels.
import type { AgentRole, LevelNumber, LevelSettingsPatch } from '@pra/core';
import {
  lockAppSettings,
  lockLevelSettings,
  lockRoleModels,
  writeAppSettings,
  writeLevelSettings,
  writeRoleModels,
} from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

export type RoleModelSettings = Record<AgentRole, string>;
export type DefaultLevelSetting = { defaultLevel: LevelNumber };

/** The one entity of the models area: the model of every role, changed together. */
export const MODELS_ENTITY = 'roles';
/** The global default level is an entity of the levels area, beside levels "1" to "6". */
export const DEFAULT_LEVEL_ENTITY = 'default';

export function modelsStore(): SettingsStore<RoleModelSettings> {
  return {
    area: 'models',
    read: (tx) => lockRoleModels(tx),
    async write(tx, entity, after) {
      if (after === null) throw new Error('the model settings cannot be removed');
      await writeRoleModels(tx, after);
      return { entity, value: await lockRoleModels(tx) };
    },
  };
}

/** One level's own values; the entity is the level number. */
export function levelStore(): SettingsStore<LevelSettingsPatch> {
  return {
    area: 'levels',
    read: (tx, entity) => lockLevelSettings(tx, Number(entity) as LevelNumber),
    async write(tx, entity, after) {
      const value = await writeLevelSettings(tx, Number(entity) as LevelNumber, after ?? {});
      return { entity, value };
    },
  };
}

export function defaultLevelStore(): SettingsStore<DefaultLevelSetting> {
  return {
    area: 'levels',
    read: async (tx) => ({ defaultLevel: (await lockAppSettings(tx)).defaultLevel }),
    async write(tx, entity, after) {
      if (after === null) throw new Error('the default level cannot be removed');
      const current = await lockAppSettings(tx);
      const stored = await writeAppSettings(tx, { ...current, defaultLevel: after.defaultLevel });
      return { entity, value: { defaultLevel: stored.defaultLevel } };
    },
  };
}
