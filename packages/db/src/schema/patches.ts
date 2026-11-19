// Implementer patches (S-13-T2). An implementer run writes one patch revision when it completes;
// people edit or revert its files, and a revise run writes the next revision, which supersedes it.
import { ACTOR_KINDS, type PatchReproduction, type PatchStatus } from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { runs } from './runs.ts';
import { teamMembers } from './team.ts';

export const PATCH_STATUSES = [
  'ready',
  'superseded',
  'pushed',
  'discarded',
] as const satisfies readonly PatchStatus[];

export const PATCH_FILE_STATUSES = ['changed', 'edited', 'reverted'] as const;
export type PatchFileStatus = (typeof PATCH_FILE_STATUSES)[number];

export const patches = pgTable(
  'patches',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** The implementer run that wrote this revision. */
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** The reviewed commit the patch applies to. */
    baseSha: text('base_sha').notNull(),
    revision: integer().notNull(),
    /** Findings the implementer was given (the "of M"). */
    findingIds: jsonb('finding_ids').$type<number[]>().notNull(),
    /** Findings it claims to have fixed (the "N"). */
    fixedFindingIds: jsonb('fixed_finding_ids').$type<number[]>().notNull(),
    /** Reproduction per fixed finding id, on the patched tree. */
    reproductions: jsonb().$type<Record<string, PatchReproduction>>().notNull(),
    summary: text().notNull().default(''),
    /** The note a revise run worked from; null for revision 1. */
    reviseNote: text('revise_note'),
    status: text({ enum: PATCH_STATUSES }).notNull().default('ready'),
    /** A patch check is re-running the reproductions after an edit or revert. */
    checking: boolean().notNull().default(false),
    /** Bumped when a patch check stores new reproduction results. */
    checkVersion: integer('check_version').notNull().default(0),
    startedBy: text('started_by', { enum: ACTOR_KINDS }).notNull(),
    startedByMemberId: uuid('started_by_member_id').references(() => teamMembers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patches_run').on(t.runId),
    unique('patches_revision').on(t.pullRequestId, t.revision),
    index('patches_pull_request').on(t.pullRequestId, t.revision),
    check('patches_status', sql`${t.status} in ('ready', 'superseded', 'pushed', 'discarded')`),
  ],
);

export const patchFiles = pgTable(
  'patch_files',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    patchId: integer('patch_id')
      .notNull()
      .references(() => patches.id, { onDelete: 'cascade' }),
    path: text().notNull(),
    /** Content at the base commit; null when the patch adds the file. */
    baseBlobKey: text('base_blob_key'),
    /** Content after the patch; null when the patch deletes the file. */
    blobKey: text('blob_key'),
    status: text({ enum: PATCH_FILE_STATUSES }).notNull().default('changed'),
  },
  (t) => [
    unique('patch_files_path').on(t.patchId, t.path),
    check('patch_files_status', sql`${t.status} in ('changed', 'edited', 'reverted')`),
  ],
);

/** What an implementer run works on: written with the run, read by its stages. */
export const implementerRequests = pgTable('implementer_requests', {
  runId: integer('run_id')
    .primaryKey()
    .references(() => runs.id, { onDelete: 'cascade' }),
  findingIds: jsonb('finding_ids').$type<number[]>().notNull(),
  /** A revise run starts from this patch's files. */
  revisesPatchId: integer('revises_patch_id').references((): AnyPgColumn => patches.id, {
    onDelete: 'set null',
  }),
  note: text(),
});
