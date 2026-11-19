import { AGENT_ROLES, LEVEL_NUMBERS, type LevelSettingsPatch } from '@pra/core';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * A level's own settings (S-21): core `LevelSettingsPatch`. A field it leaves out is inherited from
 * the level below. One row per level 1 to 6; the migration adds them empty.
 */
export const levelSettings = pgTable(
  'level_settings',
  {
    level: integer().primaryKey(),
    settings: jsonb().$type<LevelSettingsPatch>().notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('level_settings_level', sql.raw(`level in (${LEVEL_NUMBERS.join(', ')})`)),
    check('level_settings_object', sql`jsonb_typeof(${t.settings}) = 'object'`),
  ],
);

/** The model of each agent role (S-21); a level may override it. The migration adds the defaults. */
export const modelSettings = pgTable(
  'model_settings',
  {
    role: text({ enum: AGENT_ROLES }).primaryKey(),
    model: text().notNull(),
    updatedAt: updatedAt(),
  },
  () => [
    check(
      'model_settings_role',
      sql.raw(`role in (${AGENT_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
  ],
);
