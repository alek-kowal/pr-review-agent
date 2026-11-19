// S-21-T3: what Settings → Models and Review levels read, shared by their routes.
import {
  AGENT_ROLES,
  LEVEL_NUMBERS,
  LEVEL_SETTING_KEYS,
  LevelSettingsPatchSchema,
  ModelNameSchema,
  resolveLevelSettings,
  type LevelNumber,
  type LevelOverrides,
  type LevelSettingsPatch,
  type RoleModels,
} from '@pra/core';
import { z } from 'zod/v4';

export const LevelSchema = z.union(LEVEL_NUMBERS.map((n) => z.literal(n)));

export const ModelChoiceSchema = z.object({
  role: z.enum(AGENT_ROLES),
  model: z.string(),
  /** `level`: a level override (`level` names it); `settings`: Settings → Models. */
  source: z.enum(['level', 'settings', 'default']),
  level: z.number().int().nullable(),
});

const OriginSchema = z.object({ level: LevelSchema, source: z.enum(['built_in', 'override']) });

export const LevelViewSchema = z.object({
  number: LevelSchema,
  /** Core `LEVEL_KEYS`; the web maps it to the level's name. */
  key: z.string(),
  /** The stages and features this level adds to the one below it. */
  adds: z.array(z.string()),
  /** This level's own values; every other value is inherited. */
  own: z.record(z.string(), z.unknown()),
  settings: z.object({
    brief: z.string().nullable(),
    maxFindings: z.number().int(),
    maxQuestions: z.number().int(),
    stageTimeoutMinutes: z.number(),
    autofixMaxPatches: z.number().int().nullable(),
  }),
  /** The level each value comes from, and whether it is built in or an override. */
  origins: z.record(z.string(), OriginSchema),
  models: z.array(ModelChoiceSchema),
});
export type LevelView = z.output<typeof LevelViewSchema>;

export function levelView(
  n: LevelNumber,
  overrides: LevelOverrides,
  roleModels: RoleModels,
): LevelView {
  const view = resolveLevelSettings(n, overrides, roleModels);
  return {
    number: view.number,
    key: view.key,
    adds: view.adds,
    own: view.own as Record<string, unknown>,
    settings: view.settings,
    origins: view.origins,
    models: AGENT_ROLES.map((role) => ({ role, ...view.models[role] })),
  };
}

/** A value, or `inherit` to drop the level's own value and take the one below. */
const INHERIT = z.literal('inherit');
const ownOrInherit = <T extends z.ZodType>(schema: T) => z.union([INHERIT, schema]).optional();
const patchShape = LevelSettingsPatchSchema.shape;

/**
 * A level's own values as `PUT /api/settings/levels/:n` takes them: every own value of the level.
 * A field left out or set to `inherit` is inherited from the level below.
 */
export const LevelValuesSchema = z.object({
  brief: ownOrInherit(patchShape.brief.unwrap()),
  maxFindings: ownOrInherit(patchShape.maxFindings.unwrap()),
  maxQuestions: ownOrInherit(patchShape.maxQuestions.unwrap()),
  stageTimeoutMinutes: ownOrInherit(patchShape.stageTimeoutMinutes.unwrap()),
  autofixMaxPatches: ownOrInherit(patchShape.autofixMaxPatches.unwrap()),
  models: z
    .object(
      Object.fromEntries(
        AGENT_ROLES.map((role) => [role, ownOrInherit(ModelNameSchema)]),
      ) as Record<
        (typeof AGENT_ROLES)[number],
        ReturnType<typeof ownOrInherit<typeof ModelNameSchema>>
      >,
    )
    .optional(),
});
export type LevelValues = z.output<typeof LevelValuesSchema>;

/** The level's own values from what the client sent: `inherit` and missing fields drop out. */
export function ownValuesOf(values: LevelValues): LevelSettingsPatch {
  const own: Record<string, unknown> = {};
  for (const key of LEVEL_SETTING_KEYS) {
    const value = values[key];
    if (value !== undefined && value !== 'inherit') own[key] = value;
  }
  const models: Record<string, string> = {};
  for (const role of AGENT_ROLES) {
    const model = values.models?.[role];
    if (model !== undefined && model !== 'inherit') models[role] = model;
  }
  if (Object.keys(models).length > 0) own.models = models;
  return own as LevelSettingsPatch;
}
