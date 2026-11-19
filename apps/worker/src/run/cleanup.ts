import type { Repository } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { runSessionsDir, worktreeKey } from '../stages/paths.ts';
import { removeTree } from '../stages/review/prompt.ts';

/** Removes the run's worktree and session files once it ended. Failures are logged only. */
export async function removeRunFiles(
  deps: Pick<WorkerDeps, 'gitMirror' | 'dataDir' | 'logger'>,
  repository: Pick<Repository, 'githubFullName'>,
  runId: number,
): Promise<void> {
  try {
    await deps.gitMirror.removeWorktree(repository.githubFullName, worktreeKey(runId));
  } catch (error) {
    deps.logger.warn({ err: error, runId }, 'worktree removal failed');
  }
  try {
    await removeTree(runSessionsDir(deps.dataDir, runId));
  } catch (error) {
    deps.logger.warn({ err: error, runId }, 'session files removal failed');
  }
}
