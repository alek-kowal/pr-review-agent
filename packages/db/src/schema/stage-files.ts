// The instruction files a stage reads (STAGEFILES): a choice per stage at global scope, with an
// optional repository override. A null slot inherits (repository → global → the slot's default).
import { FILE_STAGE_KEYS } from '@pra/core';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { repositories } from './repositories.ts';

export const stageFileChoices = pgTable(
  'stage_file_choices',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Null for the global choice. */
    repositoryId: integer('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    /** The pipeline stage key (core `FILE_STAGE_KEYS`). */
    stage: text({ enum: FILE_STAGE_KEYS }).notNull(),
    /** A file key, or core `BUILT_IN_FILE` for the built-in prompt. */
    prompt: text(),
    rules: text(),
    /** Document file keys. */
    documents: jsonb().$type<string[]>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('stage_file_choices_target').on(t.repositoryId, t.stage).nullsNotDistinct(),
    check(
      'stage_file_choices_stage',
      sql.raw(`stage in (${FILE_STAGE_KEYS.map((key) => `'${key}'`).join(', ')})`),
    ),
    check(
      'stage_file_choices_documents',
      sql`${t.documents} is null or jsonb_typeof(${t.documents}) = 'array'`,
    ),
  ],
);
