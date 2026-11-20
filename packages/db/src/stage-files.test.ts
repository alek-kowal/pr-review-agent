// STAGEFILES: instruction kinds (the migration's backfill and new files) and the stage-file
// choices at global and repository scope.
import { defaultKindOf } from '@pra/core';
import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  ensureInstructionFile,
  lockStageFileChoice,
  schema,
  stageFileChoicesOf,
  allStageFileChoices,
  startInstructionCopy,
  upsertRepository,
  writeStageFileChoice,
} from './index.ts';
import { testDatabaseUrl, uniqueId } from './testing/index.ts';
import { eq, inArray, sql } from 'drizzle-orm';

const db = createDb(testDatabaseUrl(), { max: 2 });
afterAll(() => closeDb(db));

const newRepository = async () => {
  const id = uniqueId();
  return upsertRepository(db, { slug: `stage-files-${id}`, githubFullName: `acme-${id}/sf` });
};

describe('instruction kinds', () => {
  test("the migration's backfill gives existing files the kind defaultKindOf gives", async () => {
    const migration = await readFile(
      new URL('../migrations/0030_stage-files.sql', import.meta.url),
      'utf8',
    );
    const statement = migration
      .split('-- Hand-written (STAGEFILES)')[1]!
      .split('\n')
      .find((line) => line.startsWith('UPDATE '))!
      .trim()
      .replace(/;$/, '');
    expect(statement).toMatch(/^UPDATE "instruction_files" SET "kind" = 'instruction' WHERE /);

    const repository = await newRepository();
    const keys = [
      'prompt-x.md',
      'feature-map/prompt-y.md',
      'verify-rules.md',
      'lessons.md',
      'review-levels.json',
      'feature-map/sdk.md',
    ];
    const rows = await db
      .insert(schema.instructionFiles)
      .values(
        keys.map((fileKey) => ({
          scope: 'repository' as const,
          repositoryId: repository.id,
          fileKey,
          kind: 'document' as const,
        })),
      )
      .returning({ id: schema.instructionFiles.id });
    const ids = rows.map((row) => row.id).join(', ');
    // Only these rows: other test files share the database.
    await db.execute(sql.raw(statement.replace(' WHERE ', ` WHERE "id" in (${ids}) AND (`) + ')'));

    const after = await db
      .select({ fileKey: schema.instructionFiles.fileKey, kind: schema.instructionFiles.kind })
      .from(schema.instructionFiles)
      .where(
        inArray(
          schema.instructionFiles.id,
          rows.map((row) => row.id),
        ),
      );
    expect(Object.fromEntries(after.map((row) => [row.fileKey, row.kind]))).toEqual(
      Object.fromEntries(keys.map((key) => [key, defaultKindOf(key)])),
    );
  });

  test('a new file takes its kind, else the same key elsewhere, else the default', async () => {
    const repository = await newRepository();
    const fileKey = `test-only/${uniqueId()}-rules.md`;
    const global = await ensureInstructionFile(db, { scope: 'global', fileKey, kind: 'document' });
    expect(global.kind).toBe('document');
    const copy = await ensureInstructionFile(db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey,
    });
    expect(copy.kind).toBe('document');
    const fresh = await ensureInstructionFile(db, {
      scope: 'global',
      fileKey: `test-only/${uniqueId()}-rules.md`,
    });
    expect(fresh.kind).toBe('instruction');
  });

  test('a copy keeps the kind of its source', async () => {
    const repository = await newRepository();
    const source = await ensureInstructionFile(db, {
      scope: 'global',
      fileKey: `test-only/${uniqueId()}.md`,
      kind: 'instruction',
    });
    await db
      .insert(schema.instructionVersions)
      .values({ fileId: source.id, version: 1, status: 'active', content: 'x' });
    const copy = await startInstructionCopy(db, source, {
      scope: 'repository',
      repositoryId: repository.id,
    });
    expect(copy.ok && copy.file.kind).toBe('instruction');
  });
});

describe('stage-file choices', () => {
  test('global and repository choices are read, locked, replaced and removed', async () => {
    const repository = await newRepository();
    const other = await newRepository();
    // The global choice is shared by every test file, so this test writes repository ones only.
    await db.transaction(async (tx) => {
      await writeStageFileChoice(tx, repository.id, 'verify', { rules: 'verify-rules-b.md' });
      await writeStageFileChoice(tx, other.id, 'review', {
        documents: ['a.md'],
        prompt: '@built-in',
      });
      const choices = await stageFileChoicesOf(tx, repository.id);
      expect(choices.repository).toEqual({ verify: { rules: 'verify-rules-b.md' } });
      const all = await allStageFileChoices(tx);
      expect(all.repositories.get(other.id)).toEqual({
        review: { prompt: '@built-in', documents: ['a.md'] },
      });
    });

    const locked = await db.transaction((tx) => lockStageFileChoice(tx, repository.id, 'verify'));
    expect(locked).toEqual({ rules: 'verify-rules-b.md' });
    // Nothing stored: null, and the placeholder row the lock adds goes with the rollback.
    await expect(
      db.transaction(async (tx) => {
        expect(await lockStageFileChoice(tx, repository.id, 'analyst')).toBeNull();
        tx.rollback();
      }),
    ).rejects.toThrow();
    const rows = () =>
      db
        .select()
        .from(schema.stageFileChoices)
        .where(eq(schema.stageFileChoices.repositoryId, repository.id));
    expect((await rows()).map((row) => row.stage)).toEqual(['verify']);

    await db.transaction((tx) =>
      writeStageFileChoice(tx, repository.id, 'verify', { prompt: 'p.md', rules: null }),
    );
    expect((await stageFileChoicesOf(db, repository.id)).repository).toEqual({
      verify: { prompt: 'p.md' },
    });
    // An empty choice removes the row: the stage inherits again.
    await db.transaction((tx) => writeStageFileChoice(tx, repository.id, 'verify', {}));
    expect(await rows()).toEqual([]);
    // Global scope never sees repository overrides.
    expect((await stageFileChoicesOf(db, null)).repository).toEqual({});
  });
});
