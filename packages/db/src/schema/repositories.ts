import { CHANGE_TYPES, type AppSettings, type RepositoryConfig } from '@pra/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** A connected GitHub repository. Its behaviour comes from `config`, never from code. */
export const repositories = pgTable('repositories', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  slug: text().notNull().unique(),
  githubFullName: text('github_full_name').notNull().unique(),
  /** Set from the first webhook the GitHub App delivers for this repository. */
  installationId: bigint('installation_id', { mode: 'number' }),
  /** Validated with core `RepositoryConfigSchema` on every write. */
  config: jsonb().$type<RepositoryConfig>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const PR_STATES = ['open', 'closed', 'merged'] as const;
export type PrState = (typeof PR_STATES)[number];

/** The latest GitHub snapshot of one pull request. */
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    title: text().notNull(),
    body: text().notNull().default(''),
    authorLogin: text('author_login').notNull(),
    headSha: text('head_sha').notNull(),
    baseSha: text('base_sha').notNull(),
    headRef: text('head_ref').notNull(),
    baseRef: text('base_ref').notNull(),
    isDraft: boolean('is_draft').notNull(),
    /** The head repository differs from the base repository. */
    isFork: boolean('is_fork').notNull(),
    state: text({ enum: PR_STATES }).notNull(),
    commitsCount: integer('commits_count').notNull(),
    /** A change type a person forced (FR-030); it wins over the rules and skips the judge. */
    forcedChangeType: text('forced_change_type', { enum: CHANGE_TYPES }),
    /** The review level for this PR's next rounds (FR-059); null: the repository's default. */
    level: integer(),
    /** GitHub's dates, refreshed with every snapshot. */
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('pull_requests_repository_number').on(t.repositoryId, t.number),
    check('pull_requests_state', sql`${t.state} in ('open', 'closed', 'merged')`),
    check(
      'pull_requests_forced_change_type',
      sql`${t.forcedChangeType} in ('uses_existing', 'changes_behaviour', 'one_way_door')`,
    ),
  ],
);

/** Every GitHub webhook delivery, stored once per delivery id. The raw payload sits in BlobStore. */
export const githubEvents = pgTable('github_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  deliveryId: text('delivery_id').notNull().unique(),
  /** `X-GitHub-Event`, for example `pull_request` or `ping`. */
  event: text().notNull(),
  action: text(),
  repositoryFullName: text('repository_full_name'),
  prNumber: integer('pr_number'),
  blobKey: text('blob_key').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  /** Reason code the worker recorded, for example `round_started` or `repository_not_connected`. */
  outcome: text(),
});

/** One row (id 1) with the app's settings, validated with core `AppSettingsSchema`. */
export const appSettings = pgTable(
  'app_settings',
  {
    id: integer().primaryKey().default(1),
    settings: jsonb().$type<AppSettings>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [check('app_settings_single_row', sql`${t.id} = 1`)],
);

export const INSTRUCTION_SCOPES = ['global', 'repository'] as const;
export type InstructionScope = (typeof INSTRUCTION_SCOPES)[number];
export const INSTRUCTION_STATUSES = ['active', 'draft', 'archived'] as const;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];

/**
 * Versions of the files the agents read (reviewer prompt, rules, lessons, feature map). A file is
 * global or belongs to one repository; at most one version of a file is active. S-22 builds on it.
 */
export const instructionVersions = pgTable(
  'instruction_versions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    scope: text({ enum: INSTRUCTION_SCOPES }).notNull(),
    repositoryId: integer('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    /** Path inside the instructions directory, for example `review-rules.md` or `feature-map/sdk.md`. */
    fileKey: text('file_key').notNull(),
    version: integer().notNull(),
    status: text({ enum: INSTRUCTION_STATUSES }).notNull(),
    content: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('instruction_versions_file_version')
      .on(t.scope, t.repositoryId, t.fileKey, t.version)
      .nullsNotDistinct(),
    // Global files have no repository; coalesce makes them collide with each other too.
    uniqueIndex('instruction_versions_one_active')
      .on(t.scope, sql`coalesce(${t.repositoryId}, 0)`, t.fileKey)
      .where(sql`${t.status} = 'active'`),
    check(
      'instruction_versions_scope_repository',
      sql`(${t.scope} = 'global') = (${t.repositoryId} is null)`,
    ),
    check('instruction_versions_scope', sql`${t.scope} in ('global', 'repository')`),
    check('instruction_versions_status', sql`${t.status} in ('active', 'draft', 'archived')`),
  ],
);
