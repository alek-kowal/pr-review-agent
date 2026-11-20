import {
  defaultKindOf,
  resolveInstructions,
  type InstructionKind,
  type InstructionLayer,
  type InstructionScope,
  type InstructionTarget,
  type LevelNumber,
  type Reason,
} from '@pra/core';
import { and, asc, desc, eq, getTableColumns, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../client.ts';
import {
  instructionFiles,
  instructionVersions,
  runInstructionVersions,
} from '../schema/instructions.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { trials } from '../schema/trials.ts';
import { runs, type RunInstructionVersion } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';

export type InstructionFileRow = typeof instructionFiles.$inferSelect;
export type InstructionVersionRow = typeof instructionVersions.$inferSelect;
/** A version with its file's scope and key. */
export type InstructionVersion = InstructionVersionRow &
  Pick<InstructionFileRow, 'scope' | 'repositoryId' | 'level' | 'fileKey' | 'kind'>;

/**
 * Where a file lives: global, one repository's copy or one level's copy. A new file takes `kind`,
 * else the kind of the same key at another scope, else core `defaultKindOf`.
 */
export type InstructionFileRef = (
  | { scope: 'global'; repositoryId?: null; level?: null; fileKey: string }
  | { scope: 'repository'; repositoryId: number; level?: null; fileKey: string }
  | { scope: 'level'; repositoryId?: null; level: LevelNumber; fileKey: string }
) & { kind?: InstructionKind };

export type InstructionFile = InstructionFileRef & { content: string };

const versionWithFile = {
  ...getTableColumns(instructionVersions),
  scope: instructionFiles.scope,
  repositoryId: instructionFiles.repositoryId,
  level: instructionFiles.level,
  fileKey: instructionFiles.fileKey,
  kind: instructionFiles.kind,
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
  const [existing] = await db.select().from(instructionFiles).where(whereFile(ref));
  if (existing) return existing;
  const kind = ref.kind ?? (await kindOfKey(db, ref.fileKey)) ?? defaultKindOf(ref.fileKey);
  const [inserted] = await db
    .insert(instructionFiles)
    .values({
      scope: ref.scope,
      repositoryId: ref.scope === 'repository' ? ref.repositoryId : null,
      level: ref.scope === 'level' ? ref.level : null,
      fileKey: ref.fileKey,
      kind,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [raced] = await db.select().from(instructionFiles).where(whereFile(ref));
  return raced!;
}

/** The kind of a key at any scope (every scope keeps one kind per key), or null for a new key. */
export async function kindOfKey(db: Executor, fileKey: string): Promise<InstructionKind | null> {
  const [row] = await db
    .select({ kind: instructionFiles.kind })
    .from(instructionFiles)
    .where(eq(instructionFiles.fileKey, fileKey))
    .orderBy(asc(instructionFiles.id))
    .limit(1);
  return (row?.kind as InstructionKind | undefined) ?? null;
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
    kind: file.kind,
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
      kind: v.kind as InstructionKind,
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

// Settings → Instructions (S-22-T4).

/** A file with its repository's slug (repository copies). */
export type InstructionFileWithRepository = InstructionFileRow & { repositorySlug: string | null };

/** A file with its active version and its draft, for the list. */
export type InstructionFileSummary = InstructionFileWithRepository & {
  active: InstructionVersionRow | null;
  draft: InstructionVersionRow | null;
};

const SCOPE_ORDER: Record<string, number> = { global: 0, repository: 1, level: 2 };

function selectFiles(db: Executor) {
  return db
    .select({ ...getTableColumns(instructionFiles), repositorySlug: repositories.slug })
    .from(instructionFiles)
    .leftJoin(repositories, eq(repositories.id, instructionFiles.repositoryId));
}

/** Every file: global first, then repository copies by slug, then level copies by level. */
export async function listInstructionFiles(db: Executor): Promise<InstructionFileSummary[]> {
  const files = await selectFiles(db);
  if (!files.length) return [];
  const current = await db
    .select()
    .from(instructionVersions)
    .where(
      and(
        inArray(
          instructionVersions.fileId,
          files.map((f) => f.id),
        ),
        inArray(instructionVersions.status, ['active', 'draft']),
      ),
    );
  const of = (fileId: number, status: string) =>
    current.find((v) => v.fileId === fileId && v.status === status) ?? null;
  return files
    .sort(
      (a, b) =>
        SCOPE_ORDER[a.scope]! - SCOPE_ORDER[b.scope]! ||
        (a.repositorySlug ?? '').localeCompare(b.repositorySlug ?? '') ||
        (a.level ?? 0) - (b.level ?? 0) ||
        a.fileKey.localeCompare(b.fileKey),
    )
    .map((f) => ({ ...f, active: of(f.id, 'active'), draft: of(f.id, 'draft') }));
}

export async function getInstructionFile(
  db: Executor,
  id: number,
): Promise<InstructionFileWithRepository | null> {
  const [file] = await selectFiles(db).where(eq(instructionFiles.id, id));
  return file ?? null;
}

/** A run that read a version. */
export type InstructionVersionRun = {
  runId: number;
  kind: string;
  prNumber: number;
  repositorySlug: string;
  createdAt: Date;
};

/** A version with its author's and signer's names and the runs that read it (newest first). */
export type InstructionVersionDetail = InstructionVersionRow & {
  createdByName: string | null;
  activatedByName: string | null;
  runCount: number;
  runs: InstructionVersionRun[];
};

/** How many runs a version lists; `runCount` has the total. */
export const VERSION_RUNS_LISTED = 20;

/** A file's versions, newest first. */
export async function instructionFileVersions(
  db: Executor,
  fileId: number,
): Promise<InstructionVersionDetail[]> {
  const author = alias(teamMembers, 'author');
  const signer = alias(teamMembers, 'signer');
  const versions = await db
    .select({
      ...getTableColumns(instructionVersions),
      createdByName: author.name,
      activatedByName: signer.name,
    })
    .from(instructionVersions)
    .leftJoin(author, eq(author.id, instructionVersions.createdByMemberId))
    .leftJoin(signer, eq(signer.id, instructionVersions.activatedByMemberId))
    .where(eq(instructionVersions.fileId, fileId))
    .orderBy(desc(instructionVersions.version));
  if (!versions.length) return [];
  const used = await db
    .select({
      versionId: runInstructionVersions.versionId,
      runId: runs.id,
      kind: runs.kind,
      prNumber: pullRequests.number,
      repositorySlug: repositories.slug,
      createdAt: runs.createdAt,
    })
    .from(runInstructionVersions)
    .innerJoin(runs, eq(runs.id, runInstructionVersions.runId))
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      inArray(
        runInstructionVersions.versionId,
        versions.map((v) => v.id),
      ),
    )
    .orderBy(desc(runs.id));
  return versions.map((v) => {
    const mine = used
      .filter((u) => u.versionId === v.id)
      .map((u) => ({
        runId: u.runId,
        kind: u.kind,
        prNumber: u.prNumber,
        repositorySlug: u.repositorySlug,
        createdAt: u.createdAt,
      }));
    return { ...v, runCount: mine.length, runs: mine.slice(0, VERSION_RUNS_LISTED) };
  });
}

export async function getInstructionVersion(
  db: Executor,
  id: number,
): Promise<InstructionVersion | null> {
  const [version] = await selectVersions(db).where(eq(instructionVersions.id, id));
  return version ?? null;
}

/** A file's version by its number. */
export async function findInstructionVersion(
  db: Executor,
  fileId: number,
  version: number,
): Promise<InstructionVersionRow | null> {
  const [row] = await db
    .select()
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, fileId), eq(instructionVersions.version, version)));
  return row ?? null;
}

/** The file's active version, if it has one. */
export async function activeVersionOf(
  db: Executor,
  fileId: number,
): Promise<InstructionVersionRow | null> {
  const [active] = await db
    .select()
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, fileId), eq(instructionVersions.status, 'active')));
  return active ?? null;
}

/** The file's active version, locked until the transaction ends. */
export async function lockActiveInstructionVersion(
  tx: Executor,
  fileId: number,
): Promise<InstructionVersionRow | null> {
  const [active] = await tx
    .select()
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, fileId), eq(instructionVersions.status, 'active')))
    .for('update');
  return active ?? null;
}

/**
 * Saves the file's draft, unsigned ("by hand"): a file has at most one draft, so this updates it
 * or adds the next version number as the draft. Returns null when the file does not exist.
 */
export async function saveInstructionDraft(
  db: Executor,
  fileId: number,
  draft: { content: string; note: string | null },
): Promise<InstructionVersionRow | null> {
  const [file] = await db
    .select({ id: instructionFiles.id })
    .from(instructionFiles)
    .where(eq(instructionFiles.id, fileId))
    .for('update');
  if (!file) return null;
  const [current] = await db
    .select({ id: instructionVersions.id })
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, fileId), eq(instructionVersions.status, 'draft')));
  if (current) {
    // A draft a trial read stays as the trial saw it: it is set aside (archived, never active)
    // and the save becomes the next version.
    const [tried] = await db
      .select({ id: trials.id })
      .from(trials)
      .where(eq(trials.draftVersionId, current.id))
      .limit(1);
    if (tried) {
      await db
        .update(instructionVersions)
        .set({ status: 'archived' })
        .where(eq(instructionVersions.id, current.id));
    } else {
      const [updated] = await db
        .update(instructionVersions)
        .set({ content: draft.content, note: draft.note, createdBy: 'hand', createdAt: new Date() })
        .where(eq(instructionVersions.id, current.id))
        .returning();
      return updated!;
    }
  }
  const [{ last }] = (await db
    .select({ last: max(instructionVersions.version) })
    .from(instructionVersions)
    .where(eq(instructionVersions.fileId, fileId))) as [{ last: number | null }];
  const [inserted] = await db
    .insert(instructionVersions)
    .values({
      fileId,
      version: (last ?? 0) + 1,
      status: 'draft',
      content: draft.content,
      note: draft.note,
      createdBy: 'hand',
    })
    .returning();
  return inserted!;
}

/**
 * Creates a global or repository file with version 1 as an unsigned draft (Settings → Instructions
 * → New file, STAGEFILES). `exists` when the scope has the key already; `kind_conflict` when the key
 * exists at another scope with the other kind (one key keeps one kind everywhere).
 */
export async function createInstructionFile(
  tx: Executor,
  ref: InstructionFileRef & { kind: InstructionKind },
  draft: { content: string; note: string | null },
): Promise<
  | { ok: true; file: InstructionFileRow; draft: InstructionVersionRow }
  | { ok: false; reason: 'exists'; fileId: number }
  | { ok: false; reason: 'kind_conflict'; kind: InstructionKind }
> {
  // One New file per key at a time, so the two checks below hold until the insert commits.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('instruction_file_key'), hashtext(${ref.fileKey}))`,
  );
  const [existing] = await tx.select().from(instructionFiles).where(whereFile(ref));
  if (existing) return { ok: false, reason: 'exists', fileId: existing.id };
  const kind = await kindOfKey(tx, ref.fileKey);
  if (kind && kind !== ref.kind) return { ok: false, reason: 'kind_conflict', kind };
  const [file] = await tx
    .insert(instructionFiles)
    .values({
      scope: ref.scope,
      repositoryId: ref.scope === 'repository' ? ref.repositoryId : null,
      level: ref.scope === 'level' ? ref.level : null,
      fileKey: ref.fileKey,
      kind: ref.kind,
    })
    .returning();
  const [version] = await tx
    .insert(instructionVersions)
    .values({
      fileId: file!.id,
      version: 1,
      status: 'draft',
      content: draft.content,
      note: draft.note,
      createdBy: 'hand',
    })
    .returning();
  return { ok: true, file: file!, draft: version! };
}

/**
 * Throws the file's draft away, unsigned (STAGEFILES). A draft a trial or a run read is archived
 * (never active) so they keep their rows; otherwise it is deleted, and a file left with no version
 * goes too. Returns what happened, or null when the file has no draft.
 */
export async function discardInstructionDraft(
  tx: Executor,
  fileId: number,
): Promise<'deleted' | 'archived' | 'file_removed' | null> {
  // The file row first, the order `saveInstructionDraft` and copies lock in.
  const [file] = await tx
    .select({ id: instructionFiles.id })
    .from(instructionFiles)
    .where(eq(instructionFiles.id, fileId))
    .for('update');
  if (!file) return null;
  const [draft] = await tx
    .select({ id: instructionVersions.id })
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, fileId), eq(instructionVersions.status, 'draft')))
    .for('update');
  if (!draft) return null;
  const [tried] = await tx
    .select({ id: trials.id })
    .from(trials)
    .where(eq(trials.draftVersionId, draft.id))
    .limit(1);
  const [read] = await tx
    .select({ runId: runInstructionVersions.runId })
    .from(runInstructionVersions)
    .where(eq(runInstructionVersions.versionId, draft.id))
    .limit(1);
  if (tried || read) {
    await tx
      .update(instructionVersions)
      .set({ status: 'archived' })
      .where(eq(instructionVersions.id, draft.id));
    return 'archived';
  }
  await tx.delete(instructionVersions).where(eq(instructionVersions.id, draft.id));
  const [left] = await tx
    .select({ id: instructionVersions.id })
    .from(instructionVersions)
    .where(eq(instructionVersions.fileId, fileId))
    .limit(1);
  if (left) return 'deleted';
  await tx.delete(instructionFiles).where(eq(instructionFiles.id, fileId));
  return 'file_removed';
}

/** Where a copy goes: one repository's or one level's. */
export type InstructionCopyTarget =
  { scope: 'repository'; repositoryId: number } | { scope: 'level'; level: LevelNumber };

/**
 * Starts a repository or level copy of a file as a draft version 1 with the source's active text.
 * `exists` when the copy is already there; `no_active` when the source has no active version.
 */
export async function startInstructionCopy(
  db: Executor,
  source: InstructionFileRow,
  target: InstructionCopyTarget,
): Promise<
  | { ok: true; file: InstructionFileRow; draft: InstructionVersionRow }
  | { ok: false; reason: 'exists' | 'no_active' }
> {
  const [active] = await db
    .select()
    .from(instructionVersions)
    .where(
      and(eq(instructionVersions.fileId, source.id), eq(instructionVersions.status, 'active')),
    );
  if (!active) return { ok: false, reason: 'no_active' };
  const [file] = await db
    .insert(instructionFiles)
    .values({
      scope: target.scope,
      repositoryId: target.scope === 'repository' ? target.repositoryId : null,
      level: target.scope === 'level' ? target.level : null,
      fileKey: source.fileKey,
      kind: source.kind,
    })
    .onConflictDoNothing()
    .returning();
  if (!file) return { ok: false, reason: 'exists' };
  const [draft] = await db
    .insert(instructionVersions)
    .values({
      fileId: file.id,
      version: 1,
      status: 'draft',
      content: active.content,
      note: null,
      createdBy: 'hand',
    })
    .returning();
  return { ok: true, file, draft: draft! };
}
