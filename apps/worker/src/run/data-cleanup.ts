// P-27: the disk cleanup the deploy timer runs (`pnpm data:cleanup`). A run's worktree (with its
// node_modules) and session files go when the run ends (`removeRunFiles`); this sweeps what a
// crash or a failed removal left, the package caches after they reach their age, and the mirrors
// and caches of repositories that are no longer connected.
import { activeRuns, listRepositories, type Executor } from '@pra/db';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

export type DataCleanupOptions = {
  /** A repository's package cache is wiped at this age when none of its runs is in progress. */
  cacheMaxAgeDays: number;
  /** A worktree that belongs to no run (a patch check's) is removed at this age. */
  strayMaxAgeHours: number;
  /** List what would go, remove nothing. */
  dryRun?: boolean;
  now?: number;
};

export type DataCleanupResult = {
  worktrees: string[];
  sessions: string[];
  caches: string[];
  mirrors: string[];
};

/** Marks when a cache was started; its age counts from this file. */
export const CACHE_STAMP = '.pra-cache-created';

const RUN_DIR = /^run-(\d+)$/;
const HOUR = 3_600_000;
const run = promisify(execFile);

export async function cleanupData(
  deps: { db: Executor; dataDir: string },
  options: DataCleanupOptions,
): Promise<DataCleanupResult> {
  const now = options.now ?? Date.now();
  const active = await activeRuns(deps.db);
  const activeIds = new Set(active.map((row) => row.run.id));
  const busySlugs = new Set(active.map((row) => row.repositorySlug));
  const repositories = await listRepositories(deps.db);
  const slugs = new Set(repositories.map((repository) => repository.slug));
  const fullNames = new Set(repositories.map((repository) => repository.githubFullName));
  const result: DataCleanupResult = { worktrees: [], sessions: [], caches: [], mirrors: [] };
  const remove = async (list: string[], dir: string) => {
    list.push(dir);
    if (!options.dryRun) await rm(dir, { recursive: true, force: true });
  };

  const gitDir = path.join(deps.dataDir, 'git');
  for (const name of await entries(path.join(gitDir, 'worktrees'))) {
    const dir = path.join(gitDir, 'worktrees', name);
    const runId = RUN_DIR.exec(name)?.[1];
    const ended = runId !== undefined && !activeIds.has(Number(runId));
    const stray = runId === undefined && now - (await mtime(dir)) > options.strayMaxAgeHours * HOUR;
    if (ended || stray) await remove(result.worktrees, dir);
  }
  for (const name of await entries(path.join(deps.dataDir, 'sessions'))) {
    const runId = RUN_DIR.exec(name)?.[1];
    if (runId !== undefined && !activeIds.has(Number(runId))) {
      await remove(result.sessions, path.join(deps.dataDir, 'sessions', name));
    }
  }

  const cacheRoot = path.join(deps.dataDir, 'cache');
  for (const slug of await entries(cacheRoot)) {
    const dir = path.join(cacheRoot, slug);
    if (!slugs.has(slug)) {
      await remove(result.caches, dir);
      continue;
    }
    const stamp = path.join(dir, CACHE_STAMP);
    if (!existsSync(stamp)) {
      if (!options.dryRun) await writeFile(stamp, '');
      continue;
    }
    const old = now - (await mtime(stamp)) > options.cacheMaxAgeDays * 24 * HOUR;
    if (old && !busySlugs.has(slug)) await remove(result.caches, dir);
  }

  const mirrorRoot = path.join(gitDir, 'mirrors');
  for (const owner of await entries(mirrorRoot)) {
    for (const name of await entries(path.join(mirrorRoot, owner))) {
      const mirror = path.join(mirrorRoot, owner, name);
      if (!fullNames.has(`${owner}/${name.replace(/\.git$/, '')}`)) {
        await remove(result.mirrors, mirror);
      } else if (!options.dryRun) {
        // Forget the worktrees removed above.
        await run('git', ['--git-dir', mirror, 'worktree', 'prune']).catch(() => undefined);
      }
    }
  }
  return result;
}

async function entries(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}

async function mtime(file: string): Promise<number> {
  return (await stat(file)).mtimeMs;
}
