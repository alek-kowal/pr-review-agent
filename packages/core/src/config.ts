import './reasons/config.ts';
import { z } from 'zod/v4';
import { DEFAULT_MODELS, type ResolvedLevel } from './levels.ts';
import { isValidGlob } from './glob.ts';
import { isValidTaskIdPattern } from './task-id.ts';
import { MAX_FINDINGS } from './limits.ts';
import { reason, type Reason } from './reason.ts';
import { AGENT_ROLES, LEVEL_NUMBERS, type AgentRole, type LevelNumber } from './vocabulary.ts';

/**
 * Model names reach an agent runtime, so a name must not look like a flag or carry shell or
 * argument syntax: it starts with a letter or digit and holds only `A-Z a-z 0-9 . _ : @ [ ] -`.
 */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@[\]-]{0,99}$/;
export const validModelName = (name: string): boolean => MODEL_NAME.test(name);

const levelNumber = z.union(LEVEL_NUMBERS.map((n) => z.literal(n)));
/** A path pattern (glob.ts); `invalid_glob` when the matcher would not read it as meant. */
const pattern = z.string().trim().min(1).refine(isValidGlob, { message: 'invalid_glob' });
/** A model per role; an empty value means "not set here" and falls back. */
const modelName = z
  .string()
  .trim()
  .refine((name) => name === '' || validModelName(name), { message: 'invalid model name' });
const modelsByRole = z.object(
  Object.fromEntries(AGENT_ROLES.map((role) => [role, modelName.optional()])) as Record<
    AgentRole,
    z.ZodOptional<typeof modelName>
  >,
);

export const SensitivePatternSchema = z.object({
  pattern,
  reason: z.string().trim().min(1),
});

export const ChangeTypeRulesSchema = z.object({
  usesExistingPaths: z.array(pattern),
  oneWayPaths: z.array(pattern),
  sizeLines: z.number().int().positive(),
});

export const DEFAULT_CHANGE_TYPE_RULES: z.output<typeof ChangeTypeRulesSchema> = {
  usesExistingPaths: [],
  oneWayPaths: [],
  sizeLines: 400,
};
export const DEFAULT_LARGE_PR_LINES = 1000;

/** A repository's ClickUp settings. */
export const ClickUpSettingsSchema = z.object({
  /** ClickUp's workspace (team) id. */
  workspaceId: z.string().trim().min(1),
  /** Narrows the search for a task that links the PR to one space; null: the whole workspace. */
  spaceId: z.string().trim().min(1).nullable().default(null),
  /** Where follow-up tasks go; null: follow-ups cannot be created in ClickUp. */
  followUpListId: z.string().trim().min(1).nullable().default(null),
  /** A regular expression for task ids in branch names and PR titles, e.g. `WB-\d+`. */
  taskIdPattern: z
    .string()
    .trim()
    .min(1)
    .refine(isValidTaskIdPattern, { message: 'invalid_task_id_pattern' }),
});
export type ClickUpSettings = z.output<typeof ClickUpSettingsSchema>;

/** One repository's settings. A new repository needs only these, never code. */
export const RepositoryConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  githubFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  defaultBranch: z.string().trim().min(1).default('main'),
  defaultLevel: levelNumber.default(1),
  /**
   * Downloads the PR's packages from its lockfile, with network but no PR scripts or hooks
   * (e.g. `pnpm fetch --frozen-lockfile --ignore-scripts --ignore-pnpmfile`). Null: no fetch step.
   */
  fetchCommand: z.string().trim().min(1).nullable().default(null),
  /** Installs from the fetched packages with no network (e.g. `pnpm install --offline`). */
  installCommand: z.string().trim().min(1).nullable().default(null),
  /** ClickUp for this repository; null turns ClickUp off for it. */
  clickup: ClickUpSettingsSchema.nullable().default(null),
  sensitivePatterns: z.array(SensitivePatternSchema).default([]),
  changeTypeRules: ChangeTypeRulesSchema.default(DEFAULT_CHANGE_TYPE_RULES),
  /** Above this many changed lines a PR is flagged as large. */
  largePrLines: z.number().int().positive().default(DEFAULT_LARGE_PR_LINES),
});
export type RepositoryConfig = z.output<typeof RepositoryConfigSchema>;

/** Whether `zone` is an IANA time zone the runtime knows (for example `Europe/Warsaw`). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_TIME_ZONE = 'Europe/Warsaw';
export const MAX_AGENT_SLOTS = 20;

/** Settings for the whole app. */
export const AppSettingsSchema = z.object({
  paused: z.boolean().default(false),
  pausedReason: z.string().nullable().default(null),
  /** The Team member who paused (signed); null while running. */
  pausedBy: z.string().nullable().default(null),
  /** When the pause started (ISO time); null while running. */
  pausedAt: z.string().nullable().default(null),
  /** Daily budget in USD; null means no budget, which never holds a review. */
  dailyBudgetUsd: z.number().positive().nullable().default(null),
  agentSlots: z.number().int().min(1).max(MAX_AGENT_SLOTS).default(2),
  /** The day (and so today's spend) starts at midnight in this zone (OQ9). */
  timeZone: z
    .string()
    .refine(isValidTimeZone, { message: 'invalid_time_zone' })
    .default(DEFAULT_TIME_ZONE),
  models: modelsByRole.default({}),
  /** "Ready for team member review (round N)" on GitHub after each completed round. */
  afterRoundGithubComment: z.boolean().default(true),
});
export type AppSettings = z.output<typeof AppSettingsSchema>;
export const DEFAULT_APP_SETTINGS: AppSettings = AppSettingsSchema.parse({});

export const LevelSettingsPatchSchema = z.object({
  brief: z.string().nullable().optional(),
  maxFindings: z.number().int().min(0).max(MAX_FINDINGS).optional(),
  maxQuestions: z.number().int().min(0).max(10).optional(),
  stageTimeoutMinutes: z.number().int().min(1).max(240).optional(),
  autofixMaxPatches: z.number().int().min(0).max(10).nullable().optional(),
  models: modelsByRole.optional(),
});

/** Level settings by level number ("1" to "6"); a broken level falls back on its own. */
export const LevelOverridesSchema = z.object(
  Object.fromEntries(LEVEL_NUMBERS.map((n) => [n, LevelSettingsPatchSchema.optional()])) as Record<
    `${LevelNumber}`,
    z.ZodOptional<typeof LevelSettingsPatchSchema>
  >,
);

export interface Parsed<T> {
  value: T;
  warnings: Reason[];
}

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/** The object schema under `.default()` and `.optional()`, if there is one. */
function objectInside(schema: z.ZodType): z.ZodObject | null {
  let current: z.ZodType = schema;
  while (current instanceof z.ZodDefault || current instanceof z.ZodOptional) {
    current = current.unwrap() as z.ZodType;
  }
  return current instanceof z.ZodObject ? current : null;
}

/**
 * Parses stored settings. A broken field falls back to its default with a `config_field_invalid`
 * warning that names the field; the other fields keep their stored values. Inside a nested object
 * (change-type rules, models, a level's settings) the fallback is per field too, and the warning
 * names the path, for example `changeTypeRules.oneWayPaths` or `2.models.reviewer`.
 */
export function parseWithFallback<S extends z.ZodObject>(
  schema: S,
  defaults: z.output<S>,
  raw: unknown,
): Parsed<z.output<S>> {
  const whole = schema.safeParse(raw);
  if (whole.success) return { value: whole.data, warnings: [] };

  const warnings: Reason[] = isObject(raw) ? [] : [reason('config_not_object')];
  const input = isObject(raw) ? raw : {};
  const value: Record<string, unknown> = {};
  for (const [field, fieldSchema] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const parsed = fieldSchema.safeParse(input[field]);
    if (parsed.success) {
      if (parsed.data !== undefined) value[field] = parsed.data;
      continue;
    }
    const inner = objectInside(fieldSchema);
    const nested = input[field];
    const fallback = (defaults as Record<string, unknown>)[field];
    if (inner && isObject(nested)) {
      const sub = parseWithFallback(inner, isObject(fallback) ? fallback : {}, nested);
      const repaired = fieldSchema.safeParse(sub.value);
      if (repaired.success) {
        value[field] = repaired.data;
        for (const w of sub.warnings) {
          if (w.code === 'config_field_invalid') {
            warnings.push(
              reason('config_field_invalid', { ...w.params, field: `${field}.${w.params.field}` }),
            );
          }
        }
        continue;
      }
    }
    if (fallback !== undefined) value[field] = fallback;
    const issue = parsed.error.issues[0]?.code ?? 'invalid';
    warnings.push(reason('config_field_invalid', { field, issue }));
  }
  return { value: value as z.output<S>, warnings };
}

export interface ModelChoice {
  model: string;
  source: 'level' | 'settings' | 'default';
  /** The level that set it, when `source` is `level`. */
  level: LevelNumber | null;
}

const usable = (name: string | undefined): name is string => !!name && validModelName(name.trim());

/** The model for a role: the level override, then the app settings, then the default. */
export function modelFor(
  settings: Pick<AppSettings, 'models'>,
  level: Pick<ResolvedLevel, 'models' | 'origins'> | null,
  role: AgentRole,
): ModelChoice {
  const fromLevel = level?.models[role];
  if (usable(fromLevel)) {
    return {
      model: fromLevel.trim(),
      source: 'level',
      level: level?.origins.models[role]?.level ?? null,
    };
  }
  const fromSettings = settings.models[role];
  if (usable(fromSettings)) return { model: fromSettings.trim(), source: 'settings', level: null };
  return { model: DEFAULT_MODELS[role], source: 'default', level: null };
}

/**
 * Why a review must wait now: paused, or the daily budget reached. No budget (null) or a zero
 * budget never holds (P `control.test.ts:53`: 0 means no limit).
 */
export function holdReason(
  settings: Pick<AppSettings, 'paused' | 'pausedReason' | 'dailyBudgetUsd'>,
  spentToday: number,
): Reason | null {
  if (settings.paused) return reason('paused', { note: settings.pausedReason });
  const budget = settings.dailyBudgetUsd;
  if (budget != null && budget > 0 && spentToday >= budget) {
    return reason('budget_reached', { spentUsd: spentToday, budgetUsd: budget });
  }
  return null;
}
