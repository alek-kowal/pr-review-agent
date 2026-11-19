// S-11: the sensitive files of a PR. A completed round adds new matches as pending, the next push
// turns sent back into pending, and a person approves (by hand) or sends back (signed) the files
// that are not approved yet, on the version they saw.
import { HAND, member, type SensitiveFiles, type SensitiveMatch } from '@pra/core';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests } from '../schema/repositories.ts';
import { sensitiveFiles } from '../schema/sensitive-files.ts';
import type { Transactor } from './decisions.ts';
import { recordStateChange, recordTimelineEntry } from './timeline.ts';

export type SensitiveFile = typeof sensitiveFiles.$inferSelect;

/** Rows of these PRs by PR id, in path order. */
export async function sensitiveFilesOf(
  db: Executor,
  pullRequestIds: readonly number[],
): Promise<Map<number, SensitiveFile[]>> {
  const byPr = new Map<number, SensitiveFile[]>();
  if (pullRequestIds.length === 0) return byPr;
  const rows = await db
    .select()
    .from(sensitiveFiles)
    .where(inArray(sensitiveFiles.pullRequestId, [...pullRequestIds]))
    .orderBy(asc(sensitiveFiles.path));
  for (const row of rows) {
    const list = byPr.get(row.pullRequestId) ?? [];
    list.push(row);
    byPr.set(row.pullRequestId, list);
  }
  return byPr;
}

/**
 * The PR's sensitive files as core sees them: null without any; approved when every file is;
 * otherwise the files not approved yet, sent back when any of them was.
 */
export function sensitiveState(rows: readonly SensitiveFile[]): SensitiveFiles | null {
  if (rows.length === 0) return null;
  const open = rows.filter((row) => row.status !== 'approved');
  if (open.length === 0) {
    return { status: 'approved', files: rows.map((row) => row.path), sentBackBy: null };
  }
  const sentBack = open.find((row) => row.status === 'sent_back');
  return {
    status: sentBack ? 'sent_back' : 'pending',
    files: open.map((row) => row.path),
    sentBackBy: sentBack?.memberId ? member(sentBack.memberId) : null,
  };
}

/**
 * Every write here locks the PR row before the file rows, as settling does, so a push reset and an
 * approval at the same moment queue instead of deadlocking.
 */
async function lockPullRequest(tx: Executor, pullRequestId: number): Promise<void> {
  await tx
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(eq(pullRequests.id, pullRequestId))
    .for('update');
}

async function bumpVersion(db: Executor, pullRequestId: number): Promise<number> {
  const [row] = await db
    .update(pullRequests)
    .set({ sensitiveVersion: sql`${pullRequests.sensitiveVersion} + 1` })
    .where(eq(pullRequests.id, pullRequestId))
    .returning({ version: pullRequests.sensitiveVersion });
  return row!.version;
}

/** Adds the matches the PR does not have yet as pending. Returns the added rows. */
export async function addSensitiveFiles(
  db: Transactor,
  pullRequestId: number,
  matches: readonly SensitiveMatch[],
  headSha: string,
): Promise<SensitiveFile[]> {
  if (matches.length === 0) return [];
  return db.transaction(async (tx) => {
    await lockPullRequest(tx, pullRequestId);
    const added = await tx
      .insert(sensitiveFiles)
      .values(
        matches.map((match) => ({
          pullRequestId,
          path: match.path,
          pattern: match.pattern,
          reason: match.reason,
          headSha,
        })),
      )
      .onConflictDoNothing({ target: [sensitiveFiles.pullRequestId, sensitiveFiles.path] })
      .returning();
    if (added.length > 0) await bumpVersion(tx, pullRequestId);
    return added;
  });
}

/**
 * The author pushed: files sent back wait for a person again. While any file waits the version
 * moves, so an approval sent from a page loaded before the push is stale. Returns the reset rows.
 */
export async function resetSentBackSensitiveFiles(
  db: Transactor,
  pullRequestId: number,
  headSha: string,
): Promise<SensitiveFile[]> {
  return db.transaction(async (tx) => {
    await lockPullRequest(tx, pullRequestId);
    const reset = await tx
      .update(sensitiveFiles)
      .set({
        status: 'pending',
        actor: null,
        memberId: null,
        comment: null,
        at: new Date(),
        headSha,
      })
      .where(
        and(
          eq(sensitiveFiles.pullRequestId, pullRequestId),
          eq(sensitiveFiles.status, 'sent_back'),
        ),
      )
      .returning();
    const [waiting] =
      reset.length > 0
        ? reset
        : await tx
            .select({ id: sensitiveFiles.id })
            .from(sensitiveFiles)
            .where(
              and(
                eq(sensitiveFiles.pullRequestId, pullRequestId),
                ne(sensitiveFiles.status, 'approved'),
              ),
            )
            .limit(1);
    if (waiting) await bumpVersion(tx, pullRequestId);
    return reset;
  });
}

/**
 * Approved files a later commit changed wait for a person again (FR-046 approves changes, not
 * paths). Returns the reopened rows.
 */
export async function reopenSensitiveFiles(
  db: Transactor,
  pullRequestId: number,
  paths: readonly string[],
  headSha: string,
): Promise<SensitiveFile[]> {
  if (paths.length === 0) return [];
  return db.transaction(async (tx) => {
    await lockPullRequest(tx, pullRequestId);
    const reopened = await tx
      .update(sensitiveFiles)
      .set({
        status: 'pending',
        actor: null,
        memberId: null,
        comment: null,
        at: new Date(),
        headSha,
      })
      .where(
        and(
          eq(sensitiveFiles.pullRequestId, pullRequestId),
          eq(sensitiveFiles.status, 'approved'),
          inArray(sensitiveFiles.path, [...paths]),
        ),
      )
      .returning();
    if (reopened.length > 0) await bumpVersion(tx, pullRequestId);
    return reopened;
  });
}

export type SettleSensitiveInput = {
  pullRequestId: number;
  /** The `sensitive_version` the person saw. */
  version: number;
} & (
  | { action: 'approve' }
  | { action: 'send_back'; /** The signing Team member. */ memberId: string; comment: string }
);

export type SettleSensitiveResult =
  | { ok: true; files: SensitiveFile[]; version: number }
  | { ok: false; reason: 'not_found' | 'nothing_to_settle' }
  | { ok: false; reason: 'stale'; version: number };

/**
 * Approves (by hand) or sends back (signed) every file not approved yet, in one transaction with
 * its timeline entry and the state it leaves the PR in. The PR row is locked and its sensitive
 * version compared with the one the person saw.
 */
export async function settleSensitiveFiles(
  db: Transactor,
  input: SettleSensitiveInput,
): Promise<SettleSensitiveResult> {
  return db.transaction(async (tx) => {
    const [pr] = await tx
      .select({ version: pullRequests.sensitiveVersion, headSha: pullRequests.headSha })
      .from(pullRequests)
      .where(eq(pullRequests.id, input.pullRequestId))
      .for('update');
    if (!pr) return { ok: false, reason: 'not_found' };
    if (pr.version !== input.version) return { ok: false, reason: 'stale', version: pr.version };

    const at = new Date();
    const actor = input.action === 'approve' ? HAND : member(input.memberId);
    const files = await tx
      .update(sensitiveFiles)
      .set(
        input.action === 'approve'
          ? {
              status: 'approved',
              actor: 'hand',
              memberId: null,
              comment: null,
              at,
              headSha: pr.headSha,
            }
          : {
              status: 'sent_back',
              actor: 'member',
              memberId: input.memberId,
              comment: input.comment,
              at,
              headSha: pr.headSha,
            },
      )
      .where(
        and(
          eq(sensitiveFiles.pullRequestId, input.pullRequestId),
          ne(sensitiveFiles.status, 'approved'),
        ),
      )
      .returning();
    if (files.length === 0) return { ok: false, reason: 'nothing_to_settle' };
    const version = await bumpVersion(tx, input.pullRequestId);

    const paths = files.map((file) => file.path).sort();
    await recordTimelineEntry(tx, {
      pullRequestId: input.pullRequestId,
      actor,
      kind: input.action === 'approve' ? 'sensitive_approved' : 'sensitive_sent_back',
      params: {
        count: paths.length,
        files: paths,
        ...(input.action === 'send_back' ? { comment: input.comment } : {}),
      },
      at,
      sourceKey: `sensitive:${version}`,
    });
    await recordStateChange(
      tx,
      input.pullRequestId,
      { code: input.action === 'approve' ? 'sensitive_approved' : 'sensitive_sent_back' },
      { at },
    );
    return { ok: true, files, version };
  });
}
