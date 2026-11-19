// Instruction files by scope and their versions (S-22-T1). S-01-T1's `instruction_versions` moved
// here and now points at a file.
import { ACTOR_KINDS, INSTRUCTION_SCOPES } from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { repositories } from './repositories.ts';
import { runs } from './runs.ts';
import { teamMembers } from './team.ts';

export { INSTRUCTION_SCOPES };
export type { InstructionScope } from '@pra/core';
export const INSTRUCTION_STATUSES = ['active', 'draft', 'archived'] as const;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * One instruction file: global, a repository copy (with its repository) or a level copy (with its
 * level). A run resolves them by file key: level copy, then repository copy, then global.
 */
export const instructionFiles = pgTable(
  'instruction_files',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    scope: text({ enum: INSTRUCTION_SCOPES }).notNull(),
    repositoryId: integer('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    level: integer(),
    /** Path inside the instructions directory, for example `review-rules.md` or `feature-map/sdk.md`. */
    fileKey: text('file_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('instruction_files_scope_key')
      .on(t.scope, t.repositoryId, t.level, t.fileKey)
      .nullsNotDistinct(),
    check('instruction_files_scope', sql`${t.scope} in ('global', 'repository', 'level')`),
    check(
      'instruction_files_scope_target',
      sql`(${t.scope} = 'repository') = (${t.repositoryId} is not null) and (${t.scope} = 'level') = (${t.level} is not null)`,
    ),
    check('instruction_files_level', sql`${t.level} is null or ${t.level} between 1 and 6`),
  ],
);

/**
 * Versions of an instruction file. At most one is active; a draft changes nothing until a signed
 * activation. The author is `bot` (import), `hand` (an unsigned draft) or a member.
 */
export const instructionVersions = pgTable(
  'instruction_versions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    fileId: integer('file_id')
      .notNull()
      .references(() => instructionFiles.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    status: text({ enum: INSTRUCTION_STATUSES }).notNull(),
    content: text().notNull(),
    note: text(),
    createdBy: text('created_by', { enum: ACTOR_KINDS }).notNull().default('bot'),
    createdByMemberId: uuid('created_by_member_id').references(() => teamMembers.id),
    /** Who signed the activation that made this version active (the latest one, for a rollback). */
    activatedByMemberId: uuid('activated_by_member_id').references(() => teamMembers.id),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('instruction_versions_file_version').on(t.fileId, t.version),
    uniqueIndex('instruction_versions_one_active')
      .on(t.fileId)
      .where(sql`${t.status} = 'active'`),
    check('instruction_versions_status', sql`${t.status} in ('active', 'draft', 'archived')`),
  ],
);

/** The instruction versions a run read; frozen when the run starts. */
export const runInstructionVersions = pgTable(
  'run_instruction_versions',
  {
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    versionId: integer('version_id')
      .notNull()
      .references(() => instructionVersions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.versionId] }),
    index('run_instruction_versions_version').on(t.versionId),
  ],
);
