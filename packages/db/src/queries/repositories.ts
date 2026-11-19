import {
  parseWithFallback,
  RepositoryConfigSchema,
  type Parsed,
  type RepositoryConfig,
} from '@pra/core';
import { asc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';

export type Repository = typeof repositories.$inferSelect;
export type PullRequest = typeof pullRequests.$inferSelect;
/** What a webhook or a GitHub read says about a PR; the row id is ours. */
export type PullRequestSnapshot = Omit<typeof pullRequests.$inferInsert, 'id'>;

/** A stored repository config does not pass `RepositoryConfigSchema`. */
export class RepositoryConfigInvalidError extends Error {
  readonly code = 'repository_config_invalid';
  readonly issues: { path: string; code: string }[];
  constructor(issues: { path: string; code: string }[]) {
    super(`repository config is invalid: ${issues.map((i) => `${i.path} (${i.code})`).join(', ')}`);
    this.name = 'RepositoryConfigInvalidError';
    this.issues = issues;
  }
}

/** Parses a config for writing: every field must be valid (defaults fill missing ones). */
export function parseRepositoryConfig(raw: unknown): RepositoryConfig {
  const parsed = RepositoryConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new RepositoryConfigInvalidError(
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
  );
}

/** Reads a stored config: a broken field falls back to its default with a warning. */
export function readRepositoryConfig(repository: Repository): Parsed<RepositoryConfig> {
  const defaults = RepositoryConfigSchema.parse({
    slug: repository.slug,
    githubFullName: repository.githubFullName,
  });
  return parseWithFallback(RepositoryConfigSchema, defaults, repository.config);
}

/**
 * Inserts or updates a repository by slug from its config. Slug and full name come from the
 * config; the installation id is kept unless one is given.
 */
export async function upsertRepository(
  db: Db,
  rawConfig: unknown,
  options: { installationId?: number | null } = {},
): Promise<Repository> {
  const config = parseRepositoryConfig(rawConfig);
  const values = {
    slug: config.slug,
    githubFullName: config.githubFullName,
    config,
    ...(options.installationId !== undefined ? { installationId: options.installationId } : {}),
  };
  const [row] = await db
    .insert(repositories)
    .values(values)
    .onConflictDoUpdate({ target: repositories.slug, set: { ...values, updatedAt: sql`now()` } })
    .returning();
  return row!;
}

export async function listRepositories(db: Db): Promise<Repository[]> {
  return db.select().from(repositories).orderBy(asc(repositories.slug));
}

export async function getRepositoryBySlug(db: Db, slug: string): Promise<Repository | null> {
  const [row] = await db.select().from(repositories).where(eq(repositories.slug, slug));
  return row ?? null;
}

export async function getRepositoryByFullName(
  db: Db,
  githubFullName: string,
): Promise<Repository | null> {
  // GitHub names are case-insensitive.
  const [row] = await db
    .select()
    .from(repositories)
    .where(sql`lower(${repositories.githubFullName}) = lower(${githubFullName})`);
  return row ?? null;
}

export async function setRepositoryInstallationId(
  db: Db,
  repositoryId: number,
  installationId: number,
): Promise<void> {
  await db
    .update(repositories)
    .set({ installationId, updatedAt: sql`now()` })
    .where(eq(repositories.id, repositoryId));
}

export type UpsertPullRequestResult = {
  pullRequest: PullRequest;
  /** The row did not exist before. */
  created: boolean;
  /** Some field differs from the stored row (always true when created). */
  changed: boolean;
};

const SNAPSHOT_COLUMNS = [
  'title',
  'body',
  'authorLogin',
  'headSha',
  'baseSha',
  'headRef',
  'baseRef',
  'isDraft',
  'isFork',
  'state',
  'commitsCount',
  'openedAt',
  'updatedAt',
] as const satisfies readonly (keyof PullRequestSnapshot)[];

/**
 * Stores a PR snapshot, one row per repository and number. A snapshot equal to the stored row
 * writes nothing and returns `changed: false`.
 */
export async function upsertPullRequest(
  db: Db,
  snapshot: PullRequestSnapshot,
): Promise<UpsertPullRequestResult> {
  const columns = SNAPSHOT_COLUMNS.map((key) => pullRequests[key]);
  const excludedOf = (name: string) => sql.raw(`excluded."${name}"`);
  const stored = sql.join(columns, sql`, `);
  const incoming = sql.join(
    columns.map((column) => excludedOf(column.name)),
    sql`, `,
  );
  const set = Object.fromEntries(
    SNAPSHOT_COLUMNS.map((key) => [key, excludedOf(pullRequests[key].name)]),
  );

  const [written] = await db
    .insert(pullRequests)
    .values(snapshot)
    .onConflictDoUpdate({
      target: [pullRequests.repositoryId, pullRequests.number],
      set,
      // Skips the write (and returns no row) when nothing differs.
      setWhere: sql`(${stored}) is distinct from (${incoming})`,
    })
    .returning({ ...getTableColumns(pullRequests), created: sql<boolean>`xmax = 0` });

  if (written) {
    const { created, ...pullRequest } = written;
    return { pullRequest, created, changed: true };
  }
  const [existing] = await db
    .select()
    .from(pullRequests)
    .where(
      sql`${pullRequests.repositoryId} = ${snapshot.repositoryId} and ${pullRequests.number} = ${snapshot.number}`,
    );
  return { pullRequest: existing!, created: false, changed: false };
}

export async function getPullRequest(
  db: Db,
  repositoryId: number,
  number: number,
): Promise<PullRequest | null> {
  const [row] = await db
    .select()
    .from(pullRequests)
    .where(
      sql`${pullRequests.repositoryId} = ${repositoryId} and ${pullRequests.number} = ${number}`,
    );
  return row ?? null;
}
