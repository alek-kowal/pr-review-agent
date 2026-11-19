import { ACTOR_KINDS } from '@pra/core';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { teamMembers } from './team.ts';

/**
 * The one audit log: every settings change with who made it and the value before and after. Signed
 * changes go through the api's `applySignedSettingsChange`; the bot logs its own with actor `bot`.
 */
export const settingsChanges = pgTable(
  'settings_changes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** The Settings area, for example `team` or `budget`. */
    area: text().notNull(),
    /** What changed inside the area, for example a Team member's id. */
    entity: text().notNull(),
    /** `member` (signed, with `signer_id`), `bot`, or `hand` (unsigned). */
    actor: text({ enum: ACTOR_KINDS }).notNull(),
    signerId: uuid('signer_id').references(() => teamMembers.id),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Null when the change created the entity. */
    before: jsonb().$type<unknown>(),
    /** Null when the change removed the entity. */
    after: jsonb().$type<unknown>(),
    note: text(),
  },
  (t) => [
    index('settings_changes_at').on(t.at),
    index('settings_changes_area_entity').on(t.area, t.entity, t.at),
    check(
      'settings_changes_actor',
      sql.raw(`actor in (${ACTOR_KINDS.map((kind) => `'${kind}'`).join(', ')})`),
    ),
    check('settings_changes_signer', sql`(${t.actor} = 'member') = (${t.signerId} is not null)`),
  ],
);
