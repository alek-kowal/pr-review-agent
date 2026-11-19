// S-22-T1: instruction files by scope, their versions, and the runs that used them.
import { afterAll, describe, expect, test } from 'vitest';
import {
  activeInstructions,
  closeDb,
  createDb,
  ensureInstructionFile,
  importInstructionV1,
  schema,
  upsertRepository,
} from './index.ts';
import { testDatabaseUrl, uniqueId } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 2 });
afterAll(() => closeDb(db));

describe('instruction files and versions', () => {
  test('a file has at most one active version', async () => {
    const fileKey = `test-only/prompt-${uniqueId()}.md`;
    const { version } = await importInstructionV1(db, { scope: 'global', fileKey, content: 'v1' });

    await expect(
      db
        .insert(schema.instructionVersions)
        .values({ fileId: version.fileId, version: 2, status: 'active', content: 'v2' }),
    ).rejects.toThrow();
    // A draft next to the active version is fine.
    await db
      .insert(schema.instructionVersions)
      .values({ fileId: version.fileId, version: 2, status: 'draft', content: 'v2' });
    // Version numbers are unique per file.
    await expect(
      db
        .insert(schema.instructionVersions)
        .values({ fileId: version.fileId, version: 2, status: 'archived', content: 'again' }),
    ).rejects.toThrow();
  });

  test('a scope carries exactly its target: repository or level', async () => {
    const fileKey = `test-only/rules-${uniqueId()}.md`;
    await expect(
      db.insert(schema.instructionFiles).values({ scope: 'repository', fileKey }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.instructionFiles).values({ scope: 'global', level: 3, fileKey }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.instructionFiles).values({ scope: 'level', level: 9, fileKey }),
    ).rejects.toThrow();
    const copy = await ensureInstructionFile(db, { scope: 'level', level: 3, fileKey });
    expect(await ensureInstructionFile(db, { scope: 'level', level: 3, fileKey })).toEqual(copy);
  });

  test("a repository's active versions include global files and level copies, not other repositories'", async () => {
    const id = uniqueId();
    const wb = await upsertRepository(db, { slug: `wb-${id}`, githubFullName: `wb/${id}` });
    const other = await upsertRepository(db, { slug: `o-${id}`, githubFullName: `o/${id}` });
    const key = `test-only/lessons-${id}.md`;
    await importInstructionV1(db, {
      scope: 'repository',
      repositoryId: wb.id,
      fileKey: key,
      content: 'WB',
    });
    await importInstructionV1(db, { scope: 'level', level: 4, fileKey: key, content: 'L4' });

    const forWb = (await activeInstructions(db, wb.id)).filter((v) => v.fileKey === key);
    expect(forWb.map((v) => [v.scope, v.content]).sort()).toEqual([
      ['level', 'L4'],
      ['repository', 'WB'],
    ]);
    const forOther = (await activeInstructions(db, other.id)).filter((v) => v.fileKey === key);
    expect(forOther.map((v) => v.scope)).toEqual(['level']);
  });
});
