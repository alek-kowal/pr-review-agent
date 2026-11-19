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
    /** Moves with every change to the PR's sensitive files (S-11); a person acts on what they saw. */
    sensitiveVersion: integer('sensitive_version').notNull().default(0),
    /** GitHub's dates, refreshed with every snapshot. */
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /** First time the PR was ready for review (metrics 1 and 2); never moves after that. */
    readyAt: timestamp('ready_at', { withTimezone: true }),
    /** Set by the closed and merged events (S-19-T1); `merge_sha` is GitHub's merge commit. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    mergeSha: text('merge_sha'),
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
