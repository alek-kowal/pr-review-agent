// S-21-T1: the level ladder as Settings shows it, and the models a run snapshots.
import { modelFor, validModelName, type ModelChoice, type RoleModels } from './config.ts';
import {
  FEATURE_ON_FROM,
  LEVEL_KEYS,
  STAGE_ON_FROM,
  resolveLevel,
  type LevelFeature,
  type LevelKey,
  type LevelOverrides,
  type LevelSettings,
  type LevelSettingsPatch,
  type Origin,
  type ResolvedLevel,
} from './levels.ts';
import { reason, type Reason } from './reason.ts';
import { AGENT_ROLES, type AgentRole, type LevelNumber, type StageKey } from './vocabulary.ts';

/** The model for every role of a run, frozen on the run row when it is created. */
export type RunModels = Record<AgentRole, ModelChoice>;

/** What a level adds to the one below it: the stages and features that turn on there. */
export function levelAdds(n: LevelNumber): (StageKey | LevelFeature)[] {
  const stages = (Object.keys(STAGE_ON_FROM) as StageKey[]).filter((s) => STAGE_ON_FROM[s] === n);
  const features = (Object.keys(FEATURE_ON_FROM) as LevelFeature[]).filter(
    (f) => FEATURE_ON_FROM[f] === n,
  );
  return [...stages, ...features];
}

export interface LevelSettingsView {
  number: LevelNumber;
  key: LevelKey;
  adds: (StageKey | LevelFeature)[];
  /** This level's own values; any other value is inherited from the level below. */
  own: LevelSettingsPatch;
  settings: LevelSettings;
  /** The level that set each value and whether it is built in or an override. */
  origins: Record<keyof LevelSettings, Origin>;
  models: RunModels;
}

/** Every role's model at a resolved level: its override, then the role's setting, then default. */
export function resolveRunModels(
  level: Pick<ResolvedLevel, 'models' | 'origins'>,
  roleModels: RoleModels,
): RunModels {
  return Object.fromEntries(
    AGENT_ROLES.map((role) => [role, modelFor(roleModels, level, role)]),
  ) as RunModels;
}

/**
 * Level `n` with the per-level settings inherited from the levels below it (each value comes from
 * the nearest level at or below `n` that sets it) and the model of every role.
 */
export function resolveLevelSettings(
  n: LevelNumber,
  overrides: LevelOverrides = {},
  roleModels: RoleModels = {},
): LevelSettingsView {
  const level = resolveLevel(n, overrides);
  return {
    number: n,
    key: LEVEL_KEYS[n],
    adds: levelAdds(n),
    own: overrides[n] ?? {},
    settings: level.settings,
    origins: level.origins.settings,
    models: resolveRunModels(level, roleModels),
  };
}

/** The levels that set their own model for a role, for "Level 6 uses claude-opus-5-5". */
export function levelModelOverrides(
  overrides: LevelOverrides,
): { level: LevelNumber; role: AgentRole; model: string }[] {
  const out: { level: LevelNumber; role: AgentRole; model: string }[] = [];
  for (const [key, patch] of Object.entries(overrides)) {
    for (const role of AGENT_ROLES) {
      const model = patch?.models?.[role]?.trim();
      if (model) out.push({ level: Number(key) as LevelNumber, role, model });
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/**
 * The model a run uses for a role: its snapshot. A run from before the snapshot (empty `models`)
 * uses its frozen level's override, then the default.
 */
export function runModel(
  run: {
    level: Pick<ResolvedLevel, 'models' | 'origins'>;
    models: Partial<Record<AgentRole, ModelChoice>>;
  },
  role: AgentRole,
): string {
  return run.models[role]?.model ?? modelFor({}, run.level, role).model;
}

/** `model_invalid` for the first role whose model fails the model-name check, else null. */
export function invalidRunModel(models: Partial<Record<AgentRole, ModelChoice>>): Reason | null {
  for (const role of AGENT_ROLES) {
    const choice = models[role];
    if (choice && !validModelName(choice.model)) {
      return reason('model_invalid', { role, model: choice.model });
    }
  }
  return null;
}
