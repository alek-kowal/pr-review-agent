import { randomBytes } from 'node:crypto';
import { DEFAULT_APP_SETTINGS } from '@pra/core';
import { afterAll, describe, expect, test } from 'vitest';
import {
  activeInstructions,
  closeDb,
  createDb,
  ensureAppSettings,
  eq,
  getAppSettings,
  getRepositoryByFullName,
  importInstructionV1,
  readRepositoryConfig,
  recordGithubEvent,
  RepositoryConfigInvalidError,
  schema,
  setRepositoryInstallationId,
  sql,
  upsertPullRequest,
  upsertRepository,
  type PullRequestSnapshot,
} from './index.ts';
import { testDatabaseUrl } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

// Test files share one database, so every test uses its own names.
const unique = () => randomBytes(4).toString('hex');
const repoConfig = (slug = `repo-${unique()}`) => ({
  slug,
  githubFullName: `acme/${slug}`,
});

function snapshot(repositoryId: number, patch: Partial<PullRequestSnapshot> = {}) {
  return {
    repositoryId,
    number: 7,
    title: 'feat: add the thing',
    body: 'Body',
    authorLogin: 'octocat',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    headRef: 'feature',
    baseRef: 'main',
    isDraft: false,
    isFork: false,
    state: 'open',
    commitsCount: 2,
    openedAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-02T10:00:00Z'),
    ...patch,
  } satisfies PullRequestSnapshot;
}

describe('repositories', () => {
  test('upsert by slug keeps one row and fills config defaults', async () => {
    const config = repoConfig();
    const first = await upsertRepository(db, config);
    const second = await upsertRepository(db, { ...config, defaultBranch: 'develop' });

    expect(second.id).toBe(first.id);
    expect(second.config).toMatchObject({ defaultBranch: 'develop', defaultLevel: null });
    const rows = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.slug, config.slug));
    expect(rows).toHaveLength(1);
  });

  test('an invalid config is refused with its reason code', async () => {
    await expect(upsertRepository(db, { slug: 'Not A Slug', githubFullName: 'x' })).rejects.toThrow(
      RepositoryConfigInvalidError,
    );
    await expect(upsertRepository(db, { ...repoConfig(), defaultLevel: 9 })).rejects.toMatchObject({
      code: 'repository_config_invalid',
    });
  });

  test('a broken stored field reads as its default with a warning', async () => {
    const config = repoConfig();
    const row = await upsertRepository(db, config);
    await db
      .update(schema.repositories)
      .set({ config: sql`jsonb_set(config, '{defaultLevel}', '42')` })
      .where(eq(schema.repositories.id, row.id));
    const [stored] = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, row.id));

    const { value, warnings } = readRepositoryConfig(stored!);

    expect(value).toMatchObject({ slug: config.slug, defaultLevel: null });
    expect(warnings).toEqual([
      { code: 'config_field_invalid', params: { field: 'defaultLevel', issue: 'invalid_union' } },
    ]);
  });

  test('finds a repository by full name in any case and stores its installation id', async () => {
    const config = repoConfig();
    const row = await upsertRepository(db, config);

    await setRepositoryInstallationId(db, row.id, 12345678901);

    const found = await getRepositoryByFullName(db, config.githubFullName.toUpperCase());
    expect(found).toMatchObject({ id: row.id, installationId: 12345678901 });
    // A later config upsert keeps the installation id.
    expect(await upsertRepository(db, config)).toMatchObject({ installationId: 12345678901 });
  });
});

describe('pull requests', () => {
  test('upserting a PR snapshot twice leaves one row', async () => {
    const repo = await upsertRepository(db, repoConfig());

    const first = await upsertPullRequest(db, snapshot(repo.id));
    const second = await upsertPullRequest(db, snapshot(repo.id));

    expect(first).toMatchObject({ created: true, changed: true });
    expect(second).toEqual({ pullRequest: first.pullRequest, created: false, changed: false });
    const rows = await db
      .select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.repositoryId, repo.id));
    expect(rows).toHaveLength(1);
  });

  test('a changed snapshot updates the row in place', async () => {
    const repo = await upsertRepository(db, repoConfig());
    const first = await upsertPullRequest(db, snapshot(repo.id));

    const moved = await upsertPullRequest(
      db,
      snapshot(repo.id, { headSha: 'c'.repeat(40), commitsCount: 3 }),
    );

    expect(moved).toMatchObject({ created: false, changed: true });
    expect(moved.pullRequest).toMatchObject({
      id: first.pullRequest.id,
      headSha: 'c'.repeat(40),
      commitsCount: 3,
    });
  });

  test('the number is unique per repository, not globally', async () => {
    const a = await upsertRepository(db, repoConfig());
    const b = await upsertRepository(db, repoConfig());

    const inA = await upsertPullRequest(db, snapshot(a.id));
    const inB = await upsertPullRequest(db, snapshot(b.id));

    expect(inB.created).toBe(true);
    expect(inB.pullRequest.id).not.toBe(inA.pullRequest.id);
  });
});

describe('github events', () => {
  test('a second insert with the same delivery id is a no-op', async () => {
    const deliveryId = `delivery-${unique()}`;
    const event = {
      deliveryId,
      event: 'pull_request',
      action: 'ready_for_review',
      repositoryFullName: 'acme/widgets',
      prNumber: 7,
      blobKey: `github-events/${deliveryId}.json`,
    };

    const first = await recordGithubEvent(db, event);
    const second = await recordGithubEvent(db, { ...event, action: 'closed' });

    expect(first.created).toBe(true);
    expect(second).toEqual({ event: first.event, created: false });
    const rows = await db
      .select()
      .from(schema.githubEvents)
      .where(eq(schema.githubEvents.deliveryId, deliveryId));
    expect(rows).toEqual([first.event]);
  });
});

describe('app settings', () => {
  test('ensureAppSettings writes the defaults once and keeps one row', async () => {
    await ensureAppSettings(db);
    await ensureAppSettings(db);

    const rows = await db.select().from(schema.appSettings);
    expect(rows).toHaveLength(1);
    expect(await getAppSettings(db)).toEqual({ value: DEFAULT_APP_SETTINGS, warnings: [] });
  });

  test('a second settings row is refused', async () => {
    await expect(
      db.insert(schema.appSettings).values({ id: 2, settings: DEFAULT_APP_SETTINGS }),
    ).rejects.toThrow();
  });
});

describe('instruction versions', () => {
  test('imports version 1 once, global or per repository, and lists the active ones', async () => {
    const repo = await upsertRepository(db, repoConfig());
    const globalKey = `test-only/rules-${unique()}.md`;

    const first = await importInstructionV1(db, {
      scope: 'global',
      fileKey: globalKey,
      content: 'v1',
    });
    const again = await importInstructionV1(db, {
      scope: 'global',
      fileKey: globalKey,
      content: 'changed',
    });
    await importInstructionV1(db, {
      scope: 'repository',
      repositoryId: repo.id,
      fileKey: 'lessons.md',
      content: 'lessons',
    });

    expect(first).toMatchObject({ imported: true, version: { version: 1, status: 'active' } });
    expect(again).toEqual({ version: first.version, imported: false });
    const active = await activeInstructions(db, repo.id);
    expect(active.map((v) => [v.scope, v.fileKey, v.content])).toEqual(
      expect.arrayContaining([
        ['global', globalKey, 'v1'],
        ['repository', 'lessons.md', 'lessons'],
      ]),
    );
  });

  test('a file has at most one active version, and scope matches the repository', async () => {
    const fileKey = `test-only/prompt-${unique()}.md`;
    await importInstructionV1(db, { scope: 'global', fileKey, content: 'v1' });

    await expect(
      db.insert(schema.instructionVersions).values({
        scope: 'global',
        fileKey,
        version: 2,
        status: 'active',
        content: 'v2',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.instructionVersions).values({
        scope: 'repository',
        repositoryId: null,
        fileKey,
        version: 3,
        status: 'draft',
        content: 'v3',
      }),
    ).rejects.toThrow();
  });
});
