// S-13-T3: the patch of an implementer run, and the patch check. The patch is written when the run
// completes, once per run (a redelivered job finds it stored). A patch check reruns the fixed
// findings' reproductions after an edit or revert, on a throwaway worktree, with no model spend.
import { BOT, patchReproductions, type PatchReproduction } from '@pra/core';
import {
  getPatch,
  getRunContext,
  implementerRequest,
  runActor,
  recordTimelineEntry,
  reproductionScripts,
  storePatchCheck,
  storePatchRevision,
  succeededStageOutput,
} from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import {
  applyPatchFiles,
  implementOutput,
  patchReproduction,
  type ReproductionsOutput,
} from '../stages/implementer.ts';
import { reproduce } from '../stages/verify.ts';
import { fetchMirror } from '../stages/worktree.ts';
import type { RunHook } from './hooks.ts';

/** On a completed implementer run: the next patch revision and "Patch ready: N of M fixed". */
export const storePatchOnCompleted: RunHook = async ({ deps, run }) => {
  if (run.kind !== 'implementer') return;
  const [request, implement, checked] = await Promise.all([
    implementerRequest(deps.db, run.id),
    implementOutput({ deps, run }),
    succeededStageOutput(deps.db, run.id, 'reproductions') as Promise<ReproductionsOutput | null>,
  ]);
  if (!request || !implement) return;
  const { patch, created } = await storePatchRevision(deps.db, {
    pullRequestId: run.pullRequestId,
    runId: run.id,
    baseSha: run.headSha,
    findingIds: request.findingIds,
    fixedFindingIds: implement.fixedFindingIds,
    reproductions: checked?.reproductions ?? {},
    summary: implement.summary,
    reviseNote: request.revisesPatchId ? request.note : null,
    startedBy: runActor(run),
    files: implement.files,
  });
  if (!created) return;
  await recordTimelineEntry(deps.db, {
    pullRequestId: run.pullRequestId,
    actor: BOT,
    kind: 'patch_ready',
    params: {
      revision: patch.revision,
      fixed: patch.fixedFindingIds.length,
      total: patch.findingIds.length,
      reproductions: patchReproductions(Object.values(patch.reproductions)),
    },
    runId: run.id,
    sourceKey: `patch:${patch.id}:ready`,
  });
};

/** The worktree id of a patch check. */
const checkWorktreeKey = (patchId: number) => `patch-${patchId}`;

/** Reruns a ready patch's reproductions on its current files; stale results are dropped. */
export async function handlePatchCheck(deps: WorkerDeps, patchId: number): Promise<void> {
  const patch = await getPatch(deps.db, patchId);
  if (!patch || patch.status !== 'ready' || !patch.checking) return;
  const found = await getRunContext(deps.db, patch.runId);
  if (!found) return;
  const { pullRequest, repository } = found;
  const reproductions: Record<string, PatchReproduction> = {};
  for (const id of patch.fixedFindingIds) reproductions[String(id)] = 'not_run';
  const scripts = await reproductionScripts(deps.db, patch.fixedFindingIds);
  if (pullRequest.isFork || scripts.size === 0) {
    await storePatchCheck(deps.db, patch.id, patch.updatedAt, reproductions);
    return;
  }

  await fetchMirror({ deps, repository, run: found.run });
  const key = checkWorktreeKey(patch.id);
  const worktree = await deps.gitMirror.addWorktree(repository.githubFullName, key, patch.baseSha);
  try {
    await applyPatchFiles(deps.blobStore, worktree, patch.files);
    const signal = new AbortController().signal;
    for (const [findingId, script] of scripts) {
      const result = await reproduce({ deps, signal }, worktree, findingId, script, 1);
      reproductions[String(findingId)] = patchReproduction(result.exitCode);
    }
  } finally {
    await deps.gitMirror.removeWorktree(repository.githubFullName, key).catch((error: unknown) => {
      deps.logger.warn({ err: error, patchId }, 'patch check worktree removal failed');
    });
  }
  const stored = await storePatchCheck(deps.db, patch.id, patch.updatedAt, reproductions);
  deps.logger.info({ patchId, stored }, 'patch check finished');
}
