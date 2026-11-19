// S-11-T1: sensitive files per PR (FR-046). Before a round starts, the files the PR changes up to
// the round's head are matched against the repository's sensitive patterns and new matches are
// added as pending, and approved files changed since their approval wait again; the next push turns
// files sent back into pending again.
//
// The scan is a start gate, not a run-end hook: a hook runs after the run is committed and only
// logs its errors, so a failed scan let the PR reach Ready to merge. A gate that throws keeps the
// round queued, and its job is sent again (pg-boss retry, then `resendLostJobs`).
import { matchSensitiveFiles } from '@pra/core';
import {
  addSensitiveFiles,
  readRepositoryConfig,
  reopenSensitiveFiles,
  resetSentBackSensitiveFiles,
  sensitiveFilesOf,
} from '@pra/db';
import type { PullRequest, Repository, Run } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import type { PrEventHook } from '../github-events/pr-hooks.ts';
import type { RunGate } from './gates.ts';

/** The paths a diff changes; a renamed file counts under its old and its new path. */
async function changedPaths(
  deps: Pick<WorkerDeps, 'gitMirror'>,
  repository: Repository,
  fromSha: string,
  toSha: string,
): Promise<string[]> {
  const diff = await deps.gitMirror.diff(repository.githubFullName, fromSha, toSha);
  return [
    ...new Set(
      diff.files.flatMap((file) =>
        file.previousPath ? [file.path, file.previousPath] : [file.path],
      ),
    ),
  ];
}

/**
 * Adds the sensitive files the PR changes up to the run's head, and reopens approved files changed
 * since the head they were approved on. Throws when git fails.
 */
export async function scanSensitiveFiles(
  deps: Pick<WorkerDeps, 'db' | 'gitMirror' | 'logger'>,
  repository: Repository,
  pullRequest: PullRequest,
  run: Run,
): Promise<void> {
  const patterns = readRepositoryConfig(repository).value.sensitivePatterns;
  if (patterns.length === 0) return;
  const paths = await changedPaths(deps, repository, pullRequest.baseSha, run.headSha);
  await addSensitiveFiles(
    deps.db,
    pullRequest.id,
    matchSensitiveFiles(paths, patterns),
    run.headSha,
  );

  const approved = (
    (await sensitiveFilesOf(deps.db, [pullRequest.id])).get(pullRequest.id) ?? []
  ).filter((row) => row.status === 'approved' && row.headSha !== run.headSha);
  const changed: string[] = [];
  for (const approvedOn of new Set(approved.map((row) => row.headSha))) {
    const rows = approved.filter((row) => row.headSha === approvedOn);
    let since: Set<string>;
    try {
      since = new Set(await changedPaths(deps, repository, approvedOn, run.headSha));
    } catch (error) {
      // The approved commit is gone (force push): nobody saw this content, so ask again.
      deps.logger.warn({ err: error, runId: run.id, approvedOn }, 'approved head not comparable');
      since = new Set(rows.map((row) => row.path));
    }
    changed.push(...rows.filter((row) => since.has(row.path)).map((row) => row.path));
  }
  await reopenSensitiveFiles(deps.db, pullRequest.id, changed, run.headSha);
}

/** Before a round starts: its sensitive files are known, or the round does not start. */
export const sensitiveFilesGate: RunGate = async ({ deps, run, pullRequest, repository }) => {
  if (run.kind === 'round') await scanSensitiveFiles(deps, repository, pullRequest, run);
  return { start: true };
};

export const sensitiveOnHeadChanged: PrEventHook = async ({ deps, pullRequest }) => {
  await resetSentBackSensitiveFiles(deps.db, pullRequest.id, pullRequest.headSha);
};
