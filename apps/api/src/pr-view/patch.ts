// S-13-T4: a patch as the PR page reads it. The base and patched content of each file sit in
// BlobStore, so the diff is built here without git (core `lineDiff`).
import { lineDiff, patchReproductions, type DiffLine, type PatchReproduction } from '@pra/core';
import { PATCH_FILE_STATUSES, PATCH_STATUSES, type PatchRow, type PatchWithFiles } from '@pra/db';
import type { BlobStore } from '@pra/integrations';
import { z } from 'zod/v4';
import { iso } from './round.ts';

const CONTEXT_LINES = 3;
const timestamp = z.iso.datetime({ offset: true });

/** One `@@` hunk header. A side with no lines starts at the line before it, as in git. */
const header = (start: number, count: number) => `${count ? start : start - 1},${count}`;

/** In each block of changed lines, the removed lines come before the added ones (as in git). */
function removedFirst(lines: readonly DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  let block: DiffLine[] = [];
  const flush = () => {
    out.push(
      ...block.filter((l) => l.kind === 'removed'),
      ...block.filter((l) => l.kind === 'added'),
    );
    block = [];
  };
  for (const line of lines) {
    if (line.kind === 'same') {
      flush();
      out.push(line);
    } else {
      block.push(line);
    }
  }
  flush();
  return out;
}

/** A unified diff of one file (`--- a/path`, `+++ b/path`, hunks with 3 lines of context). */
export function unifiedDiff(path: string, before: string | null, after: string | null): string {
  const lines = removedFirst(lineDiff(before ?? '', after ?? ''));
  const changed = lines.flatMap((line, index) => (line.kind === 'same' ? [] : [index]));
  if (!changed.length) return '';

  // Changes closer than twice the context share a hunk.
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const last = ranges.at(-1);
    if (last && index - last[1] <= 2 * CONTEXT_LINES) last[1] = index;
    else ranges.push([index, index]);
  }
  const out = [before === null ? '--- /dev/null' : `--- a/${path}`];
  out.push(after === null ? '+++ /dev/null' : `+++ b/${path}`);
  for (const [first, last] of ranges) {
    const start = Math.max(0, first - CONTEXT_LINES);
    const end = Math.min(lines.length, last + CONTEXT_LINES + 1);
    const lead = lines.slice(0, start);
    const hunk = lines.slice(start, end);
    const count = (side: DiffLine['kind'], of: DiffLine[]) =>
      of.filter((line) => line.kind === 'same' || line.kind === side).length;
    out.push(
      `@@ -${header(count('removed', lead) + 1, count('removed', hunk))} ` +
        `+${header(count('added', lead) + 1, count('added', hunk))} @@`,
    );
    for (const line of hunk) {
      out.push(`${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}${line.text}`);
    }
  }
  return `${out.join('\n')}\n`;
}

const Reproduction = z.enum(['pass', 'fail', 'not_run'] as const satisfies PatchReproduction[]);

/** The patch line on the PR page: "N of M fixed · reproductions pass | fail | not run". */
export const PatchSummarySchema = z.object({
  id: z.number().int(),
  revision: z.number().int(),
  status: z.enum(PATCH_STATUSES),
  baseSha: z.string(),
  fixed: z.number().int(),
  total: z.number().int(),
  fixedFindingIds: z.array(z.number().int()),
  findingIds: z.array(z.number().int()),
  /** All reproductions in one word: any fail fails, else any pass passes, else not run. */
  reproductions: Reproduction,
  /** Each fixed finding's reproduction on the patched code, by finding id. */
  reproductionsByFinding: z.record(z.string(), Reproduction),
  /** A patch check is rerunning the reproductions after an edit or a revert. */
  checking: z.boolean(),
  /** Bumped by each finished patch check; a new value means new results. */
  checkVersion: z.number().int(),
  summary: z.string(),
  reviseNote: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type PatchSummary = z.output<typeof PatchSummarySchema>;

export function patchSummary(row: PatchRow): PatchSummary {
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    baseSha: row.baseSha,
    fixed: row.fixedFindingIds.length,
    total: row.findingIds.length,
    fixedFindingIds: row.fixedFindingIds,
    findingIds: row.findingIds,
    reproductions: patchReproductions(Object.values(row.reproductions)),
    reproductionsByFinding: row.reproductions as Record<string, PatchReproduction>,
    checking: row.checking,
    checkVersion: row.checkVersion,
    summary: row.summary,
    reviseNote: row.reviseNote,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export const PatchFileSchema = z.object({
  path: z.string(),
  /** `changed` by the agent, `edited` by a person, or `reverted` to the base. */
  status: z.enum(PATCH_FILE_STATUSES),
  /** The key an edit or revert sends back, so a stale page gets 409 `patch_stale`. */
  blobKey: z.string().nullable(),
  /** Null when the patch adds the file. */
  base: z.string().nullable(),
  /** Null when the patch deletes the file. */
  content: z.string().nullable(),
  /** Unified diff against the base; empty for a reverted file. */
  diff: z.string(),
});

export const PatchDetailSchema = z.object({
  patch: PatchSummarySchema,
  files: z.array(PatchFileSchema),
});

async function text(blobStore: BlobStore, key: string | null): Promise<string | null> {
  if (!key) return null;
  const blob = await blobStore.get(key);
  return blob ? Buffer.from(blob.body).toString('utf8') : null;
}

/** The patch with each file's base, content and diff. */
export async function patchDetail(blobStore: BlobStore, patch: PatchWithFiles) {
  const files = await Promise.all(
    patch.files.map(async (file) => {
      const [base, content] = await Promise.all([
        text(blobStore, file.baseBlobKey),
        text(blobStore, file.blobKey),
      ]);
      return {
        path: file.path,
        status: file.status,
        blobKey: file.blobKey,
        base,
        content,
        diff: unifiedDiff(file.path, base, content),
      };
    }),
  );
  return { patch: patchSummary(patch), files };
}
