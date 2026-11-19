// S-21-T1: level settings and models per role.
import {
  AGENT_ROLES,
  DEFAULT_MODELS,
  LevelOverridesSchema,
  LevelSettingsPatchSchema,
  parseWithFallback,
  type AgentRole,
  type LevelNumber,
  type LevelOverrides,
  type LevelSettingsPatch,
  type Parsed,
  type RoleModels,
} from '@pra/core';
import { asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { levelSettings, modelSettings } from '../schema/level-settings.ts';

/**
 * Every level's own settings. A broken field falls back on its own (inherited) with a
 * `config_field_invalid` warning such as `3.maxFindings`.
 */
export async function getLevelOverrides(db: Executor): Promise<Parsed<LevelOverrides>> {
  const rows = await db.select().from(levelSettings).orderBy(asc(levelSettings.level));
  const raw = Object.fromEntries(rows.map((row) => [String(row.level), row.settings]));
  const parsed = parseWithFallback(LevelOverridesSchema, {}, raw);
  return { value: parsed.value as LevelOverrides, warnings: parsed.warnings };
}

/** One level's own settings, locked until the transaction ends (`{}` when it has none). */
export async function lockLevelSettings(
  db: Executor,
  level: LevelNumber,
): Promise<LevelSettingsPatch> {
  await db.insert(levelSettings).values({ level, settings: {} }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(levelSettings)
    .where(eq(levelSettings.level, level))
    .for('update');
  const parsed = parseWithFallback(LevelSettingsPatchSchema, {}, row!.settings);
  return parsed.value;
}

/** Replaces one level's own settings (parsed: every field must be valid). */
export async function writeLevelSettings(
  db: Executor,
  level: LevelNumber,
  settings: LevelSettingsPatch,
): Promise<LevelSettingsPatch> {
  const value = LevelSettingsPatchSchema.parse(settings);
  await db
    .insert(levelSettings)
    .values({ level, settings: value })
    .onConflictDoUpdate({
      target: levelSettings.level,
      set: { settings: value, updatedAt: sql`now()` },
    });
  return value;
}

/** The model of every role as stored; a role without a row uses its default. */
export async function getRoleModels(db: Executor): Promise<Record<AgentRole, string>> {
  const rows = await db.select().from(modelSettings);
  return withDefaults(rows);
}

/** The models per role, locked until the transaction ends (missing rows get the defaults). */
export async function lockRoleModels(db: Executor): Promise<Record<AgentRole, string>> {
  await db
    .insert(modelSettings)
    .values(AGENT_ROLES.map((role) => ({ role, model: DEFAULT_MODELS[role] })))
    .onConflictDoNothing();
  const rows = await db.select().from(modelSettings).for('update');
  return withDefaults(rows);
}

/** Writes the model of each role given. Validate names first (core `RoleModelsSchema`). */
export async function writeRoleModels(db: Executor, models: RoleModels): Promise<void> {
  for (const role of AGENT_ROLES) {
    const model = models[role];
    if (model === undefined) continue;
    await db
      .insert(modelSettings)
      .values({ role, model })
      .onConflictDoUpdate({ target: modelSettings.role, set: { model, updatedAt: sql`now()` } });
  }
}

function withDefaults(rows: { role: AgentRole; model: string }[]): Record<AgentRole, string> {
  const stored = new Map(rows.map((row) => [row.role, row.model]));
  return Object.fromEntries(
    AGENT_ROLES.map((role) => [role, stored.get(role) ?? DEFAULT_MODELS[role]]),
  ) as Record<AgentRole, string>;
}
