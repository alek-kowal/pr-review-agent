// S-13-T2: implementer patches. A patch is written once per implementer run (unique run id) when
// the run completes; edits and reverts change its files in place and carry the revision and the
// file's blob key they started from (Concurrent edits NFR).
import {
  patchReproductions,
  type Actor,
  type Patch as CorePatch,
  type PatchReproduction,
} from '@pra/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { implementerRequests, patchFiles, patches } from '../schema/patches.ts';
import type { Transactor } from './decisions.ts';

export type PatchRow = typeof patches.$inferSelect;
export type PatchFileRow = typeof patchFiles.$inferSelect;
export type ImplementerRequest = typeof implementerRequests.$inferSelect;
export type PatchWithFiles = PatchRow & { files: PatchFileRow[] };

export function insertImplementerRequest(
  db: Executor,
  request: typeof implementerRequests.$inferInsert,
): Promise<unknown> {
  return db.insert(implementerRequests).values(request);
}

export async function implementerRequest(
  db: Executor,
  runId: number,
): Promise<ImplementerRequest | undefined> {
  const [row] = await db
    .select()
    .from(implementerRequests)
    .where(eq(implementerRequests.runId, runId));
  return row;
}

export type NewPatchFile = { path: string; baseBlobKey: string | null; blobKey: string | null };

export type StorePatchInput = {
  pullRequestId: number;
  runId: number;
  baseSha: string;
  findingIds: number[];
  fixedFindingIds: number[];
  reproductions: Record<string, PatchReproduction>;
  summary: string;
  reviseNote: string | null;
  startedBy: Actor;
  files: NewPatchFile[];
};

/**
 * Stores the next revision of a PR's patch and supersedes every earlier ready revision, in one
 * transaction. A second call for the same run returns the stored patch (a redelivered job).
 */
export async function storePatchRevision(
  db: Transactor,
  input: StorePatchInput,
): Promise<{ created: boolean; patch: PatchRow }> {
  return db.transaction(async (tx) => {
    // One writer per PR at a time, so two revisions never take the same number.
    await tx.execute(sql`select pg_advisory_xact_lock(${PATCH_LOCK}, ${input.pullRequestId})`);
    const [existing] = await tx.select().from(patches).where(eq(patches.runId, input.runId));
    if (existing) return { created: false, patch: existing };
    const [last] = await tx
      .select({ revision: patches.revision })
      .from(patches)
      .where(eq(patches.pullRequestId, input.pullRequestId))
      .orderBy(desc(patches.revision))
      .limit(1);
    await tx
      .update(patches)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(and(eq(patches.pullRequestId, input.pullRequestId), eq(patches.status, 'ready')));
    const [patch] = await tx
      .insert(patches)
      .values({
        pullRequestId: input.pullRequestId,
        runId: input.runId,
        baseSha: input.baseSha,
        revision: (last?.revision ?? 0) + 1,
        findingIds: input.findingIds,
        fixedFindingIds: input.fixedFindingIds,
        reproductions: input.reproductions,
        summary: input.summary,
        reviseNote: input.reviseNote,
        startedBy: input.startedBy.kind,
        startedByMemberId: input.startedBy.kind === 'member' ? input.startedBy.memberId : null,
      })
      .returning();
    if (input.files.length) {
      await tx.insert(patchFiles).values(input.files.map((f) => ({ ...f, patchId: patch!.id })));
    }
    return { created: true, patch: patch! };
  });
}

/** Advisory lock namespace for patch revisions (any constant unique to this table). */
const PATCH_LOCK = 1813;

export async function getPatch(db: Executor, id: number): Promise<PatchWithFiles | undefined> {
  const [patch] = await db.select().from(patches).where(eq(patches.id, id));
  if (!patch) return undefined;
  const files = await db
    .select()
    .from(patchFiles)
    .where(eq(patchFiles.patchId, id))
    .orderBy(asc(patchFiles.path));
  return { ...patch, files };
}

/** The newest revision of each PR's patch. */
export async function latestPatchesOf(
  db: Executor,
  pullRequestIds: readonly number[],
): Promise<Map<number, PatchRow>> {
  const latest = new Map<number, PatchRow>();
  if (!pullRequestIds.length) return latest;
  const rows = await db
    .select()
    .from(patches)
    .where(inArray(patches.pullRequestId, [...pullRequestIds]))
    .orderBy(asc(patches.revision));
  for (const row of rows) latest.set(row.pullRequestId, row);
  return latest;
}

export async function latestPatch(db: Executor, pullRequestId: number) {
  return (await latestPatchesOf(db, [pullRequestId])).get(pullRequestId);
}

/** A patch row as the core state table reads it. */
export function corePatch(row: PatchRow): CorePatch {
  return {
    status: row.status,
    fixed: row.fixedFindingIds.length,
    total: row.findingIds.length,
    reproductionsPass: patchReproductions(Object.values(row.reproductions)) === 'pass',
    waiting: null,
  };
}

export type PatchFileChange =
  | { ok: true; patch: PatchRow; file: PatchFileRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'stale'; revision: number };

type FileTarget = {
  patchId: number;
  /** The revision the person saw. */
  revision: number;
  path: string;
  /** The file's blob key the person saw. */
  expectedBlobKey: string | null;
};

/**
 * Changes one file of a ready patch when the person saw its current revision and content. It
 * resets the reproduction results and marks the patch as checking, so a patch check reruns them.
 */
async function changeFile(
  db: Transactor,
  target: FileTarget,
  change: (file: PatchFileRow) => Pick<PatchFileRow, 'blobKey' | 'status'>,
): Promise<PatchFileChange> {
  return db.transaction(async (tx) => {
    const [patch] = await tx
      .select()
      .from(patches)
      .where(eq(patches.id, target.patchId))
      .for('update');
    if (!patch) return { ok: false, reason: 'not_found' };
    const [file] = await tx
      .select()
      .from(patchFiles)
      .where(and(eq(patchFiles.patchId, patch.id), eq(patchFiles.path, target.path)));
    if (!file) return { ok: false, reason: 'not_found' };
    if (
      patch.status !== 'ready' ||
      patch.revision !== target.revision ||
      file.blobKey !== target.expectedBlobKey
    ) {
      return { ok: false, reason: 'stale', revision: patch.revision };
    }
    const [updated] = await tx
      .update(patchFiles)
      .set(change(file))
      .where(eq(patchFiles.id, file.id))
      .returning();
    const pending = Object.fromEntries(
      Object.keys(patch.reproductions).map((id) => [id, 'not_run' as const]),
    );
    const [touched] = await tx
      .update(patches)
      .set({ reproductions: pending, checking: true, updatedAt: new Date() })
      .where(eq(patches.id, patch.id))
      .returning();
    return { ok: true, patch: touched!, file: updated! };
  });
}

/** Stores a person's edit: the new content's blob key, status `edited`. */
export function editPatchFile(
  db: Transactor,
  target: FileTarget & { blobKey: string },
): Promise<PatchFileChange> {
  return changeFile(db, target, () => ({ blobKey: target.blobKey, status: 'edited' }));
}

/** Reverts a file to its base content: status `reverted`, the base blob as its content. */
export function revertPatchFile(db: Transactor, target: FileTarget): Promise<PatchFileChange> {
  return changeFile(db, target, (file) => ({ blobKey: file.baseBlobKey, status: 'reverted' }));
}

/**
 * Stores a patch check's reproduction results. `seen` is the patch's `updatedAt` when the check
 * read its files; a later edit or revert queued its own check, so this one is dropped.
 */
/** Ready patches still waiting for their check: a lost or failed check job is sent again. */
export async function patchesAwaitingCheck(db: Executor): Promise<number[]> {
  const rows = await db
    .select({ id: patches.id })
    .from(patches)
    .where(and(eq(patches.checking, true), eq(patches.status, 'ready')))
    .orderBy(asc(patches.id));
  return rows.map((row) => row.id);
}

export async function storePatchCheck(
  db: Executor,
  patchId: number,
  seen: Date,
  reproductions: Record<string, PatchReproduction>,
): Promise<boolean> {
  const rows = await db
    .update(patches)
    .set({
      reproductions,
      checking: false,
      checkVersion: sql`${patches.checkVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(patches.id, patchId),
        sql`date_trunc('milliseconds', ${patches.updatedAt}) <= ${seen.toISOString()}`,
      ),
    )
    .returning({ id: patches.id });
  return rows.length > 0;
}
