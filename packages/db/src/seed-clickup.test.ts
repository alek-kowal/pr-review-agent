import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RepositoryConfigSchema } from '@pra/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, createDb, schema } from './index.ts';
import { testDatabaseUrl, uniqueId } from './testing/index.ts';

const WB_SEED = fileURLToPath(new URL('./testing/fixtures/workflowbuilder.json', import.meta.url));
const CLI = fileURLToPath(new URL('./cli/seed-repo.ts', import.meta.url));

const db = createDb(testDatabaseUrl(), { max: 2 });
let dir: string;
let seedFile: string;
let slug: string;

beforeAll(async () => {
  // The WB seed under its own slug, so this file never races the other seed tests.
  dir = await mkdtemp(path.join(tmpdir(), 'pra-seed-clickup-'));
  slug = `wb-clickup-${uniqueId()}`.toLowerCase();
  const seed = JSON.parse(await readFile(WB_SEED, 'utf8')) as {
    repository: Record<string, unknown>;
  };
  seed.repository.slug = slug;
  seed.repository.githubFullName = `synergycodes/${slug}`;
  seedFile = path.join(dir, 'seed.json');
  await writeFile(seedFile, JSON.stringify({ repository: seed.repository }));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await closeDb(db);
});

const seedRepo = (...flags: string[]) =>
  promisify(execFile)(process.execPath, [CLI, seedFile, ...flags], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });

async function storedClickUp() {
  const [row] = await db
    .select()
    .from(schema.repositories)
    .where(eq(schema.repositories.slug, slug));
  return row ? RepositoryConfigSchema.parse(row.config).clickup : undefined;
}

describe('db:seed-repo ClickUp flags', () => {
  test('the three flags are stored in RepositoryConfig.clickup', async () => {
    await seedRepo(
      '--clickup-workspace',
      '9012345',
      '--clickup-list',
      '901234',
      '--clickup-task-pattern',
      'WB-\\d+',
    );
    expect(await storedClickUp()).toEqual({
      workspaceId: '9012345',
      spaceId: null,
      followUpListId: '901234',
      taskIdPattern: 'WB-\\d+',
    });
  }, 30_000);

  test('an invalid pattern fails and leaves the stored settings alone', async () => {
    const failed = await seedRepo(
      '--clickup-workspace',
      '1',
      '--clickup-task-pattern',
      'WB-(',
    ).catch((error: { code?: number; stderr?: string }) => error);
    expect(failed).toMatchObject({ code: 1 });
    expect((failed as { stderr: string }).stderr).toContain('invalid ClickUp flags');
    expect((await storedClickUp())?.workspaceId).toBe('9012345');
  }, 30_000);

  test('without the flags the seed file decides: the WB seed has no ClickUp', async () => {
    await seedRepo();
    expect(await storedClickUp()).toBeNull();
  }, 30_000);
});
