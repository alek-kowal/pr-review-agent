import type { InstructionLayer, InstructionScope, InstructionTarget, LevelNumber } from '@pra/core';
import { and, asc, eq, getTableColumns, isNull, or } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { instructionFiles, instructionVersions } from '../schema/instructions.ts';

export type InstructionFileRow = typeof instructionFiles.$inferSelect;
export type InstructionVersionRow = typeof instructionVersions.$inferSelect;
/** A version with its file's scope and key. */
export type InstructionVersion = InstructionVersionRow &
  Pick<InstructionFileRow, 'scope' | 'repositoryId' | 'level' | 'fileKey'>;

/** Where a file lives: global, one repository's copy or one level's copy. */
export type InstructionFileRef =
  | { scope: 'global'; repositoryId?: null; level?: null; fileKey: string }
  | { scope: 'repository'; repositoryId: number; level?: null; fileKey: string }
  | { scope: 'level'; repositoryId?: null; level: LevelNumber; fileKey: string };

export type InstructionFile = InstructionFileRef & { content: string };

const versionWithFile = {
  ...getTableColumns(instructionVersions),
  scope: instructionFiles.scope,
  repositoryId: instructionFiles.repositoryId,
  level: instructionFiles.level,
  fileKey: instructionFiles.fileKey,
};

function selectVersions(db: Executor) {
  return db
    .select(versionWithFile)
    .from(instructionVersions)
    .innerJoin(instructionFiles, eq(instructionFiles.id, instructionVersions.fileId));
}

function whereFile(ref: InstructionFileRef) {
  return and(
    eq(instructionFiles.scope, ref.scope),
    ref.scope === 'repository'
      ? eq(instructionFiles.repositoryId, ref.repositoryId)
      : isNull(instructionFiles.repositoryId),
    ref.scope === 'level' ? eq(instructionFiles.level, ref.level) : isNull(instructionFiles.level),
    eq(instructionFiles.fileKey, ref.fileKey),
  );
}

/** The file's row, created when missing. */
export async function ensureInstructionFile(
  db: Executor,
  ref: InstructionFileRef,
): Promise<InstructionFileRow> {
  const [inserted] = await db
    .insert(instructionFiles)
    .values({
      scope: ref.scope,
      repositoryId: ref.scope === 'repository' ? ref.repositoryId : null,
      level: ref.scope === 'level' ? ref.level : null,
      fileKey: ref.fileKey,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(instructionFiles).where(whereFile(ref));
  return existing!;
}

/**
 * Imports a file as version 1, active. A file that already has a version 1 keeps it: the result
 * says `kept`, and newer content belongs in a new version, not in an import.
 */
export async function importInstructionV1(
  db: Executor,
  file: InstructionFile,
): Promise<{ version: InstructionVersion; imported: boolean }> {
  const row = await ensureInstructionFile(db, file);
  const [inserted] = await db
    .insert(instructionVersions)
    .values({
      fileId: row.id,
      version: 1,
      status: 'active',
      content: file.content,
      createdBy: 'bot',
      activatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { version: withFile(inserted, row), imported: true };
  const [existing] = await db
    .select()
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, row.id), eq(instructionVersions.version, 1)));
  return { version: withFile(existing!, row), imported: false };
}

export function withFile(
  version: InstructionVersionRow,
  file: InstructionFileRow,
): InstructionVersion {
  return {
    ...version,
    scope: file.scope,
    repositoryId: file.repositoryId,
    level: file.level,
    fileKey: file.fileKey,
  };
}

/** Active versions a run of this repository may read: global ones, its own, and level copies. */
export async function activeInstructions(
  db: Executor,
  repositoryId: number,
): Promise<InstructionVersion[]> {
  return selectVersions(db)
    .where(
      and(
        eq(instructionVersions.status, 'active'),
        or(
          eq(instructionFiles.scope, 'global'),
          eq(instructionFiles.scope, 'level'),
          eq(instructionFiles.repositoryId, repositoryId),
        ),
      ),
    )
    .orderBy(asc(instructionFiles.scope), asc(instructionFiles.fileKey));
}

/** A version as core's resolution reads it. */
export function toLayer(version: InstructionVersion): InstructionLayer {
  return {
    versionId: version.id,
    fileKey: version.fileKey,
    scope: version.scope as InstructionScope,
    repositoryId: version.repositoryId,
    level: version.level as LevelNumber | null,
    version: version.version,
    content: version.content,
  };
}

/** Active versions as layers for `resolveInstructions` with this target. */
export async function activeInstructionLayers(
  db: Executor,
  target: InstructionTarget,
): Promise<InstructionLayer[]> {
  return (await activeInstructions(db, target.repositoryId)).map(toLayer);
}
