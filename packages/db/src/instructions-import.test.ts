// S-22-T2: `pnpm instructions:import` from a fixture copy of the old knowledge folder.
import { BUILT_IN_REVIEWER_PROMPT } from '@pra/core';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  activeInstructions,
  closeDb,
  createDb,
  importInstructions,
  upsertRepository,
  type InstructionsImportMap,
  type Repository,
} from './index.ts';
import { testDatabaseUrl, uniqueId } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 2 });
let source: string;
let wb: Repository;
let other: Repository;
let map: InstructionsImportMap;

const FILES: Record<string, string> = {
  'prompt-reviewer.md': 'Recenzent WB: {{knowledgeDir}} {{repoDir}}',
  'review-rules.md': 'Zasady recenzji WB',
  'lessons.md': '# Lekcje\n\nstara lekcja',
  'lessons-candidates.md': '# Kandydaci',
  'review-levels.json': '{ "default": 1 }',
  'feature-map/sdk.md': 'SDK',
};

beforeAll(async () => {
  const id = uniqueId();
  wb = await upsertRepository(db, { slug: `wb-${id}`, githubFullName: `synergycodes-${id}/wb` });
  other = await upsertRepository(db, { slug: `other-${id}`, githubFullName: `acme-${id}/x` });
  source = await mkdtemp(path.join(tmpdir(), 'pra-knowledge-'));
  for (const [key, content] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(source, key)), { recursive: true });
    await writeFile(path.join(source, key), content);
  }
  // A read-only copy, as the import must never need to write to it.
  await chmod(path.join(source, 'feature-map'), 0o555);
  await chmod(source, 0o555);
  map = {
    default: { scope: 'repository', repository: wb.slug },
    files: {},
    skip: ['lessons-candidates.md'],
    empty: ['lessons.md'],
  };
});

afterAll(async () => {
  await chmod(source, 0o755);
  await chmod(path.join(source, 'feature-map'), 0o755);
  await rm(source, { recursive: true, force: true });
  await closeDb(db);
});

describe('instructions:import', () => {
  test('a fixture folder gives the expected rows and scopes; a second run adds nothing', async () => {
    const first = await importInstructions(db, source, map);
    expect(first.imported).toEqual(
      expect.arrayContaining([
        'repository:feature-map/sdk.md',
        'repository:lessons.md',
        'repository:prompt-reviewer.md',
        'repository:review-levels.json',
        'repository:review-rules.md',
      ]),
    );
    expect(first.imported).not.toContain('repository:lessons-candidates.md');

    const forWb = await activeInstructions(db, wb.id);
    const own = forWb.filter((v) => v.scope === 'repository');
    expect(own.map((v) => [v.fileKey, v.version, v.status, v.createdBy]).sort()).toEqual([
      ['feature-map/sdk.md', 1, 'active', 'bot'],
      ['lessons.md', 1, 'active', 'bot'],
      ['prompt-reviewer.md', 1, 'active', 'bot'],
      ['review-levels.json', 1, 'active', 'bot'],
      ['review-rules.md', 1, 'active', 'bot'],
    ]);
    expect(own.find((v) => v.fileKey === 'lessons.md')!.content).toBe('');
    expect(own.find((v) => v.fileKey === 'review-rules.md')!.content).toBe('Zasady recenzji WB');

    // Global version 1 is the built-in prompt, so another repository gets no WB rules. (Test
    // files share a database: the seed test may have created the global file first.)
    expect([...first.imported, ...first.kept]).toContain('global:prompt-reviewer.md');
    const forOther = await activeInstructions(db, other.id);
    if (first.imported.includes('global:prompt-reviewer.md')) {
      const reviewer = forOther.find((v) => v.fileKey === 'prompt-reviewer.md');
      expect(reviewer).toMatchObject({ scope: 'global', content: BUILT_IN_REVIEWER_PROMPT });
    }
    const fixtureTexts = Object.values(FILES).filter(Boolean);
    expect(forOther.filter((v) => fixtureTexts.includes(v.content))).toEqual([]);

    const second = await importInstructions(db, source, map);
    expect(second.imported).toEqual([]);
    expect(second.kept).toHaveLength(first.imported.length + first.kept.length);
    expect(await activeInstructions(db, wb.id)).toHaveLength(forWb.length);
  });

  test('an unknown repository in the map fails without writing', async () => {
    const before = (await activeInstructions(db, other.id)).length;
    await expect(
      importInstructions(db, source, {
        ...map,
        default: { scope: 'repository', repository: `missing-${uniqueId()}` },
      }),
    ).rejects.toMatchObject({ code: 'repository_unknown' });
    expect(await activeInstructions(db, other.id)).toHaveLength(before);
  });
});
