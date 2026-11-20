// The run's worktree, shared by its stages: Checks installs the PR's dependencies into it, Review
// reads it, Verify runs reproductions against it. The first stage that needs it checks it out; a
// marker in the run's session folder (removed with the run's files) lets later stages reuse it.
import type { Repository, Run } from '@pra/db';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkerDeps } from '../deps.ts';
import { runSessionsDir, worktreeKey } from './paths.ts';

type WorktreeContext = {
  deps: Pick<WorkerDeps, 'github' | 'gitMirror' | 'dataDir'>;
  run: Pick<Run, 'id' | 'headSha'>;
  repository: Pick<Repository, 'githubFullName' | 'installationId'>;
  signal?: AbortSignal;
};

type Marker = { sha: string; path: string };

const markerFile = (dataDir: string, runId: number) =>
  path.join(runSessionsDir(dataDir, runId), 'worktree.json');

/**
 * Fetches the mirror with the token git needs: the installation's in App mode, the personal token
 * without the App, none for an anonymous read of a public repository (P-28).
 */
export async function fetchMirror({ deps, repository }: WorktreeContext): Promise<void> {
  const token = await deps.github.gitToken(repository.installationId);
  await deps.gitMirror.fetch(repository.githubFullName, token);
}

/**
 * The run's worktree at its head: reused when an earlier stage of the run checked it out (with
 * the dependencies Checks installed), checked out fresh otherwise.
 */
export async function runWorktree(context: WorktreeContext): Promise<string> {
  const { deps, run, repository } = context;
  const file = markerFile(deps.dataDir, run.id);
  const marker = await readFile(file, 'utf8')
    .then((text) => JSON.parse(text) as Marker)
    .catch(() => null);
  if (marker?.sha === run.headSha && existsSync(path.join(marker.path, '.git'))) {
    return marker.path;
  }
  await fetchMirror(context);
  // Git takes no signal: after the stage timeout, stop at the next step instead of going on to
  // a worktree and a session nobody waits for.
  context.signal?.throwIfAborted();
  const worktree = await deps.gitMirror.addWorktree(
    repository.githubFullName,
    worktreeKey(run.id),
    run.headSha,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ sha: run.headSha, path: worktree } satisfies Marker));
  return worktree;
}
