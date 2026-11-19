import './reasons/levels.ts';
import type { RoundKind } from './model.ts';
import { reason, type Reason } from './reason.ts';
import {
  STAGE_KEYS,
  type AgentRole,
  type LevelNumber,
  type StageKey,
  AGENT_ROLES,
} from './vocabulary.ts';

/** Level names as keys; the web maps them to copy ("Diff only", "With context", ...). */
export const LEVEL_KEYS = {
  1: 'diff_only',
  2: 'with_context',
  3: 'verified',
  4: 'fix_on_request',
  5: 'autofix',
  6: 'learning',
} as const satisfies Record<LevelNumber, string>;
export type LevelKey = (typeof LEVEL_KEYS)[LevelNumber];

/** The level from which each round stage runs. A higher level includes everything below it. */
export const STAGE_ON_FROM: Readonly<Record<StageKey, LevelNumber>> = {
  checks: 2,
  task: 2,
  change_type: 2,
  review: 1,
  verify: 3,
};

export type LevelFeature = 'implement' | 'autofix' | 'learning';
export const FEATURE_ON_FROM: Readonly<Record<LevelFeature, LevelNumber>> = {
  implement: 4,
  autofix: 5,
  learning: 6,
};

/** Default model per agent role (tech-stack.md); settings and levels may override them. */
export const DEFAULT_MODELS: Readonly<Record<AgentRole, string>> = {
  reviewer: 'claude-opus-5-5',
  verifier: 'claude-sonnet-5-5',
  implementer: 'claude-opus-5-5',
  judge: 'claude-haiku-5-5',
  analyst: 'claude-sonnet-5-5',
};

export const DEFAULT_STAGE_TIMEOUT_MINUTES = 30;
export const DEFAULT_AUTOFIX_MAX_PATCHES = 2;

/** Settings a level may set. Unset fields inherit from the level below. */
export interface LevelSettings {
  /** Extra reviewer brief for this level; null for none. */
  brief: string | null;
  maxFindings: number;
  maxQuestions: number;
  stageTimeoutMinutes: number;
  /** Automatic patches per chain; set from level 5, where autofix starts. */
  autofixMaxPatches: number | null;
}
const SETTING_KEYS = [
  'brief',
  'maxFindings',
  'maxQuestions',
  'stageTimeoutMinutes',
  'autofixMaxPatches',
] as const satisfies readonly (keyof LevelSettings)[];

export interface LevelSettingsPatch extends Partial<LevelSettings> {
  models?: Partial<Record<AgentRole, string>>;
}

/** Level settings from AppSettings, per level. */
export type LevelOverrides = Partial<Record<LevelNumber, LevelSettingsPatch>>;

const BUILT_IN: Readonly<Record<LevelNumber, LevelSettingsPatch>> = {
  1: {
    brief: null,
    maxFindings: 4,
    maxQuestions: 0,
    stageTimeoutMinutes: DEFAULT_STAGE_TIMEOUT_MINUTES,
    autofixMaxPatches: null,
  },
  2: { maxFindings: 7, maxQuestions: 3 },
  3: {},
  4: {},
  5: { autofixMaxPatches: DEFAULT_AUTOFIX_MAX_PATCHES },
  6: {},
};

/** Where a resolved value came from. */
export interface Origin {
  level: LevelNumber;
  source: 'built_in' | 'override';
}

export interface ResolvedLevel {
  number: LevelNumber;
  key: LevelKey;
  stages: Record<StageKey, boolean>;
  features: Record<LevelFeature, boolean>;
  settings: LevelSettings;
  /** Models this level (or one below it) overrides; other roles fall back to settings. */
  models: Partial<Record<AgentRole, string>>;
  origins: {
    settings: Record<keyof LevelSettings, Origin>;
    models: Partial<Record<AgentRole, Origin>>;
  };
}

const levelsUpTo = (n: LevelNumber) => Array.from({ length: n }, (_, i) => (i + 1) as LevelNumber);

/** Resolves level `n`: each value is set at the nearest level at or below `n` that sets it. */
export function resolveLevel(n: LevelNumber, overrides: LevelOverrides = {}): ResolvedLevel {
  const settings = {} as Record<keyof LevelSettings, unknown>;
  const origins = {} as Record<keyof LevelSettings, Origin>;
  const models: Partial<Record<AgentRole, string>> = {};
  const modelOrigins: Partial<Record<AgentRole, Origin>> = {};

  for (const level of levelsUpTo(n)) {
    const override = overrides[level] ?? {};
    const builtIn = BUILT_IN[level];
    for (const key of SETTING_KEYS) {
      if (override[key] !== undefined) {
        settings[key] = override[key];
        origins[key] = { level, source: 'override' };
      } else if (builtIn[key] !== undefined) {
        settings[key] = builtIn[key];
        origins[key] = { level, source: 'built_in' };
      }
    }
    for (const role of AGENT_ROLES) {
      const model = override.models?.[role]?.trim();
      if (model) {
        models[role] = model;
        modelOrigins[role] = { level, source: 'override' };
      }
    }
  }

  return {
    number: n,
    key: LEVEL_KEYS[n],
    stages: Object.fromEntries(STAGE_KEYS.map((s) => [s, n >= STAGE_ON_FROM[s]])) as Record<
      StageKey,
      boolean
    >,
    features: {
      implement: n >= FEATURE_ON_FROM.implement,
      autofix: n >= FEATURE_ON_FROM.autofix,
      learning: n >= FEATURE_ON_FROM.learning,
    },
    settings: settings as unknown as LevelSettings,
    models,
    origins: { settings: origins, models: modelOrigins },
  };
}

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
/** The level snapshot stored on a run: plain JSON, frozen, unaffected by later setting changes. */
export type FrozenLevel = DeepReadonly<ResolvedLevel>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

export function freezeLevel(level: ResolvedLevel): FrozenLevel {
  return deepFreeze(JSON.parse(JSON.stringify(level)) as ResolvedLevel);
}

/** Fix-check rounds (2 and 3 of a chain) check only the fixes. */
export const FIX_CHECK_STAGE_KEYS = ['checks', 'fix_diff', 'check_fixes', 'reproductions'] as const;
export type FixCheckStageKey = (typeof FIX_CHECK_STAGE_KEYS)[number];

export interface PlannedStage<K extends string = string> {
  key: K;
  off: boolean;
  /** `off_at_level` when the level turns the stage off. */
  reason: Reason | null;
}

const planned = <K extends string>(
  key: K,
  level: LevelNumber,
  onFrom: LevelNumber,
): PlannedStage<K> =>
  level >= onFrom
    ? { key, off: false, reason: null }
    : { key, off: true, reason: reason('off_at_level', { stage: key, level, onFrom }) };

/** The stages of a round at a level, in run order, with the ones the level turns off. */
export function stagesFor(
  level: LevelNumber | Pick<ResolvedLevel, 'number'>,
  roundKind: RoundKind,
): PlannedStage<StageKey | FixCheckStageKey>[] {
  const n = typeof level === 'number' ? level : level.number;
  if (roundKind === 'fix_check') {
    return FIX_CHECK_STAGE_KEYS.map((key) =>
      planned(key, n, key === 'checks' ? STAGE_ON_FROM.checks : 1),
    );
  }
  return STAGE_KEYS.map((key) => planned(key, n, STAGE_ON_FROM[key]));
}
