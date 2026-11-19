import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RepositoryConfigSchema } from '@pra/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  activeInstructions,
  closeDb,
  createDb,
  eq,
  readSeedFile,
  schema,
  seedRepository,
  type RepositorySeed,
} from './index.ts';
import { testDatabaseUrl, uniqueId } from './testing/index.ts';

const WB_SEED = fileURLToPath(new URL('./testing/fixtures/workflowbuilder.json', import.meta.url));
const CLI = fileURLToPath(new URL('./cli/seed-repo.ts', import.meta.url));

const db = createDb(testDatabaseUrl(), { max: 3 });
let knowledge: string;

beforeAll(async () => {
  // A small stand-in for ~/Projects/wb-factory/knowledge.
  knowledge = await mkdtemp(path.join(tmpdir(), 'pra-seed-'));
  await mkdir(path.join(knowledge, 'feature-map', 'nested'), { recursive: true });
  await writeFile(path.join(knowledge, 'prompt-reviewer.md'), 'Review {{repoDir}}.');
  await writeFile(path.join(knowledge, 'review-rules.md'), 'Rules.');
  await writeFile(path.join(knowledge, 'prompt-classifier.md'), 'Judge.');
  await writeFile(path.join(knowledge, 'classify-rules.md'), 'Judge rules.');
  await writeFile(path.join(knowledge, 'prompt-verifier.md'), 'Verify.');
  await writeFile(path.join(knowledge, 'verify-rules.md'), 'Verify rules.');
  await writeFile(path.join(knowledge, 'prompt-implementer.md'), 'Implement.');
  await writeFile(path.join(knowledge, 'implement-rules.md'), 'Implement rules.');
  await writeFile(path.join(knowledge, 'lessons.md'), 'Lessons.');
  await writeFile(path.join(knowledge, 'feature-map', 'sdk.md'), 'SDK.');
  await writeFile(path.join(knowledge, 'feature-map', 'nested', 'ui.md'), 'UI.');
  await writeFile(path.join(knowledge, 'feature-map', '.DS_Store'), '');
  await writeFile(path.join(knowledge, 'prompt-analyst.md'), 'Not in the seed.');
});
afterAll(async () => {
  await rm(knowledge, { recursive: true, force: true });
  await closeDb(db);
});

describe('the workflowbuilder seed', () => {
  test('running the command twice leaves one row, a valid config and instructions v1', async () => {
    const run = () =>
      promisify(execFile)(process.execPath, [CLI, WB_SEED, '--instructions', knowledge], {
        env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
      });

    const first = await run();
    const second = await run();

    // Test files share a database: the instructions import test may create the global reviewer
    // prompt first, so the first run counts 11 files in all, not 11 imported.
    const [firstImported, firstKept] = (
      first.stdout.match(/(\d+) imported as version 1, (\d+) already/) ?? []
    )
      .slice(1)
      .map(Number);
    expect(firstImported! + firstKept!).toBe(11);
    expect(second.stdout).toContain('0 imported as version 1, 11 already had version 1');
    const rows = await db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.slug, 'workflowbuilder'));
    expect(rows).toHaveLength(1);
    const config = RepositoryConfigSchema.parse(rows[0]!.config);
    expect(config).toMatchObject({
      githubFullName: 'synergycodes/workflowbuilder',
      defaultLevel: 1,
      defaultBranch: 'main',
      fetchCommand: 'pnpm fetch --frozen-lockfile --ignore-scripts --ignore-pnpmfile',
      installCommand: 'pnpm install --offline --frozen-lockfile',
    });
    expect(config.sensitivePatterns).toHaveLength(8);

    const versions = await activeInstructions(db, rows[0]!.id);
    const imported = versions
      .filter((v) => v.scope !== 'level')
      // Other test files add global versions under `test-only/`.
      .filter((v) => !v.fileKey.startsWith('test-only/'))
      .map((v) => [v.scope, v.fileKey, v.version, v.status])
      .sort();
    expect(imported).toEqual([
      ['global', 'classify-rules.md', 1, 'active'],
      ['global', 'implement-rules.md', 1, 'active'],
      ['global', 'prompt-classifier.md', 1, 'active'],
      ['global', 'prompt-implementer.md', 1, 'active'],
      ['global', 'prompt-reviewer.md', 1, 'active'],
      ['global', 'prompt-verifier.md', 1, 'active'],
      ['global', 'review-rules.md', 1, 'active'],
      ['global', 'verify-rules.md', 1, 'active'],
      ['repository', 'feature-map/nested/ui.md', 1, 'active'],
      ['repository', 'feature-map/sdk.md', 1, 'active'],
      ['repository', 'lessons.md', 1, 'active'],
    ]);
    expect(await db.select().from(schema.appSettings)).toHaveLength(1);
  }, 30_000);

  test('the seed file holds no value that code needs to know', async () => {
    const seed = await readSeedFile(WB_SEED);
    expect(RepositoryConfigSchema.safeParse(seed.repository).success).toBe(true);
  });
});

describe('seedRepository', () => {
  const seed = (patch: Partial<RepositorySeed['instructions']> = {}): RepositorySeed => {
    const slug = `seeded-${uniqueId()}`;
    return {
      repository: { slug, githubFullName: `acme/${slug}` },
      instructions: { global: [], repository: [], ...patch },
    };
  };

  test('without --instructions it upserts the repository only', async () => {
    const result = await seedRepository(db, seed({ repository: ['lessons.md'] }));

    expect(result.instructions).toEqual({ imported: [], kept: [] });
  });

  test('a listed file that is missing fails and writes nothing', async () => {
    const input = seed({ repository: ['lessons.md', 'missing.md'] });

    await expect(seedRepository(db, input, { instructionsDir: knowledge })).rejects.toMatchObject({
      code: 'instruction_file_missing',
    });
    const slug = input.repository.slug as string;
    expect(
      await db.select().from(schema.repositories).where(eq(schema.repositories.slug, slug)),
    ).toEqual([]);
  });

  test('an invalid repository config fails with its reason code', async () => {
    await expect(
      seedRepository(db, {
        repository: { slug: 'x' },
        instructions: { global: [], repository: [] },
      }),
    ).rejects.toMatchObject({ code: 'repository_config_invalid' });
  });
});
