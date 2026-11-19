import {
  resolveInstructions,
  type InstructionLayer,
  type InstructionScope,
  type InstructionTarget,
  type LevelNumber,
  type Reason,
} from '@pra/core';
import { and, asc, eq, getTableColumns, isNull, or } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import {
  instructionFiles,
  instructionVersions,
  runInstructionVersions,
} from '../schema/instructions.ts';
import type { RunInstructionVersion } from '../schema/runs.ts';

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

/**
 * Makes a version the file's active one (a signed activation or a rollback): the active version
 * is archived, a draft being activated stops being the draft. Call it inside the signed change's
 * transaction. Returns null when the version does not exist.
 */
export async function activateInstructionVersion(
  tx: Executor,
  versionId: number,
  signerId: string | null,
  at: Date = new Date(),
): Promise<InstructionVersionRow | null> {
  const [target] = await tx
    .select()
    .from(instructionVersions)
    .where(eq(instructionVersions.id, versionId))
    .for('update');
  if (!target) return null;
  if (target.status === 'active') return target;
  await tx
    .update(instructionVersions)
    .set({ status: 'archived' })
    .where(
      and(eq(instructionVersions.fileId, target.fileId), eq(instructionVersions.status, 'active')),
    );
  const [active] = await tx
    .update(instructionVersions)
    .set({ status: 'active', activatedAt: at, activatedByMemberId: signerId })
    .where(eq(instructionVersions.id, versionId))
    .returning();
  return active ?? null;
}

type RunRef = { id: number; level: { number: LevelNumber } };

/**
 * Freezes the versions a starting run reads (S-22-T3): resolves the active versions for its
 * repository and level, with `replace` (a trial's draft) in place of the same file's active
 * version, and records every version that contributes in `run_instruction_versions`. Returns the
 * snapshot Run detail shows.
 */
export async function freezeRunInstructions(
  tx: Executor,
  run: RunRef,
  repositoryId: number,
  replace: readonly InstructionVersion[] = [],
): Promise<RunInstructionVersion[]> {
  const replaced = new Set(replace.map((v) => v.fileId));
  const versions = [
    ...(await activeInstructions(tx, repositoryId)).filter((v) => !replaced.has(v.fileId)),
    ...replace,
  ];
  const { files } = resolveInstructions(versions.map(toLayer), {
    repositoryId,
    level: run.level.number,
  });
  const used = new Set(files.flatMap((f) => f.layers.map((l) => l.versionId)));
  const frozen = versions.filter((v) => used.has(v.id));
  if (frozen.length) {
    await tx
      .insert(runInstructionVersions)
      .values(frozen.map((v) => ({ runId: run.id, versionId: v.id })))
      .onConflictDoNothing();
  }
  return frozen
    .sort((a, b) => a.fileKey.localeCompare(b.fileKey) || a.scope.localeCompare(b.scope))
    .map((v) => ({
      id: v.id,
      fileId: v.fileId,
      scope: v.scope,
      level: v.level,
      fileKey: v.fileKey,
      version: v.version,
    }));
}

/** The versions a run recorded when it started. */
export async function versionsOfRun(db: Executor, runId: number): Promise<InstructionVersion[]> {
  return selectVersions(db)
    .innerJoin(runInstructionVersions, eq(runInstructionVersions.versionId, instructionVersions.id))
    .where(eq(runInstructionVersions.runId, runId))
    .orderBy(asc(instructionFiles.fileKey));
}

/**
 * The instruction files a run reads, by file key: its frozen versions, so activating a version
 * never changes a running run. A run without recorded versions (started before S-22) reads the
 * active ones.
 */
export async function runInstructions(
  db: Executor,
  run: RunRef,
  repositoryId: number,
): Promise<{ files: Map<string, string>; warnings: Reason[] }> {
  const frozen = await versionsOfRun(db, run.id);
  const versions = frozen.length ? frozen : await activeInstructions(db, repositoryId);
  const { files, warnings } = resolveInstructions(versions.map(toLayer), {
    repositoryId,
    level: run.level.number,
  });
  return { files: new Map(files.map((f) => [f.fileKey, f.content])), warnings };
}
