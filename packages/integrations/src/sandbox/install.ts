import { link, mkdir, readdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { DEFAULT_SANDBOX_PROFILE } from './profile.ts';
import {
  DEFAULT_SANDBOX_IMAGE,
  type Sandbox,
  type SandboxLimits,
  type SandboxResult,
} from './sandbox.ts';

/** The repository's install settings (`RepositoryConfig.fetchCommand` / `installCommand`). */
export type InstallCommands = {
  /** Downloads packages from the lockfile; runs with network but no PR scripts. */
  fetchCommand: string | null;
  /** Installs from the fetched cache; runs with no network. Null skips the install. */
  installCommand: string | null;
};

export type InstallOptions = {
  /** The run's throwaway worktree (never the bare mirror). The only writable PR folder. */
  worktree: string;
  config: InstallCommands;
  /** The repository's package cache (pnpm store, corepack). Writable only in the fetch step. */
  cacheDir: string;
  image?: string;
  fetchLimits?: SandboxLimits;
  installLimits?: SandboxLimits;
  /**
   * Hardlink the cache's pnpm store into the worktree for the install step (default true), so
   * `node_modules` shares the store's files instead of copying them. See `linkSharedStore`.
   */
  sharedStore?: boolean;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

/**
 * `skipped`: the repository has no install command. `failed`: a step exited non-zero or hit its
 * time limit (a Checks result, not a stage failure). The step results carry exit code and output.
 */
export type InstallResult = {
  status: 'ok' | 'failed' | 'skipped';
  fetch: SandboxResult | null;
  install: SandboxResult | null;
};

export const DEFAULT_FETCH_LIMITS: SandboxLimits = DEFAULT_SANDBOX_PROFILE.fetch;
export const DEFAULT_INSTALL_LIMITS: SandboxLimits = DEFAULT_SANDBOX_PROFILE.install;

const WORKDIR = '/work';
const CACHE = '/cache';
/** The install step's store inside the worktree: hardlinks of the cache's store, removed after. */
export const SHARED_STORE_DIR = '.pra-store';

/**
 * The container env: nothing from the worker. The package manager comes from the repository's
 * `packageManager` field through corepack, cached in the shared cache by the fetch step.
 */
export const INSTALL_ENV: Readonly<Record<string, string>> = {
  HOME: '/tmp',
  PATH: '/tmp/bin:/usr/local/bin:/usr/bin:/bin',
  COREPACK_HOME: `${CACHE}/corepack`,
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  npm_config_store_dir: `${CACHE}/store`,
  // pnpm re-hashes a store file whose mtime changed before linking it, so a file an earlier
  // install edited in place (shared store, P-27) is caught; the env wins over the PR's .npmrc.
  npm_config_verify_store_integrity: 'true',
};

/** Runs `command` after putting corepack's shims (pnpm, yarn) on `PATH` in the writable `/tmp`. */
export function installShell(command: string): string[] {
  return [
    'sh',
    '-c',
    `mkdir -p /tmp/bin && corepack enable --install-directory /tmp/bin && ${command}`,
  ];
}

/**
 * Installs a PR's dependencies in two sandbox runs. The fetch step may reach the registry but runs
 * no PR code (the command must ignore scripts and hooks) and gets no credentials. The install step
 * runs the PR's scripts with no network and the cache read-only. Only the worktree and the cache
 * are mounted.
 */
export async function installDependencies(
  sandbox: Sandbox,
  options: InstallOptions,
): Promise<InstallResult> {
  const { config } = options;
  if (!config.installCommand) return { status: 'skipped', fetch: null, install: null };
  await mkdir(options.cacheDir, { recursive: true });
  if (options.sharedStore === false) return runSteps(sandbox, options, `${CACHE}/store`);

  const store = path.join(options.cacheDir, 'store');
  await mkdir(store, { recursive: true });
  const linked = await linkSharedStore(store, options.worktree);
  try {
    // What the fetch step downloaded goes back to the store before any PR code runs.
    return await runSteps(sandbox, options, `${WORKDIR}/${SHARED_STORE_DIR}`, () =>
      linkTree(linked, store),
    );
  } finally {
    await rm(linked, { recursive: true, force: true });
  }
}

async function runSteps(
  sandbox: Sandbox,
  options: InstallOptions,
  storeDir: string,
  afterFetch?: () => Promise<void>,
): Promise<InstallResult> {
  const { config } = options;
  const step = (command: string, fetching: boolean) =>
    sandbox.run({
      image: options.image ?? DEFAULT_SANDBOX_IMAGE,
      command: installShell(command),
      workdir: WORKDIR,
      mounts: [
        { hostPath: options.worktree, containerPath: WORKDIR, writable: true },
        { hostPath: options.cacheDir, containerPath: CACHE, writable: fetching },
      ],
      env: { ...INSTALL_ENV, npm_config_store_dir: storeDir },
      network: fetching ? 'egress' : 'none',
      limits: fetching
        ? (options.fetchLimits ?? DEFAULT_FETCH_LIMITS)
        : (options.installLimits ?? DEFAULT_INSTALL_LIMITS),
      labels: options.labels,
      signal: options.signal,
    });

  let fetch: SandboxResult | null = null;
  if (config.fetchCommand) {
    fetch = await step(config.fetchCommand, true);
    if (!succeeded(fetch)) return { status: 'failed', fetch, install: null };
    await afterFetch?.();
  }
  const install = await step(config.installCommand!, false);
  return { status: succeeded(install) ? 'ok' : 'failed', fetch, install };
}

/**
 * Hardlinks every file of the repository's store into `<worktree>/.pra-store` and returns that
 * folder; both install steps use it as pnpm's store. A link cannot cross mounts, so with the
 * store mounted on its own pnpm would copy each package into `node_modules`; from a folder on
 * the worktree's mount it links them and an install costs almost no disk. Files the fetch step
 * adds are linked back into the store before the install step runs PR code. Trade-off
 * (context/changes/P-27): the install's scripts can change a linked file in place, and so the
 * copy later installs of this repository use. Whatever the PR put at `.pra-store` is removed
 * first (`rm` never follows a symlink) and every folder below it is created here, so no link
 * lands outside the worktree.
 */
export async function linkSharedStore(store: string, worktree: string): Promise<string> {
  const target = path.join(worktree, SHARED_STORE_DIR);
  await rm(target, { recursive: true, force: true });
  await mkdir(target);
  await linkTree(store, target);
  return target;
}

/**
 * Mirrors `from` into `to`: folders created, regular files hardlinked, files `to` already has
 * kept. Symlinks and other entries are skipped, never followed.
 */
async function linkTree(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  for (let start = 0; start < files.length; start += LINK_BATCH) {
    await Promise.all(
      files
        .slice(start, start + LINK_BATCH)
        .map((entry) => linkIfMissing(path.join(from, entry.name), path.join(to, entry.name))),
    );
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await mkdir(path.join(to, entry.name), { recursive: true });
    await linkTree(path.join(from, entry.name), path.join(to, entry.name));
  }
}

async function linkIfMissing(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

const LINK_BATCH = 64;

function succeeded(result: SandboxResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}
