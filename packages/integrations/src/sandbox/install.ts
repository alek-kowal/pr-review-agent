import { mkdir } from 'node:fs/promises';
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

export const DEFAULT_FETCH_LIMITS: SandboxLimits = {
  cpus: 2,
  memoryMb: 2048,
  pids: 512,
  timeoutMs: 10 * 60_000,
};
export const DEFAULT_INSTALL_LIMITS: SandboxLimits = {
  cpus: 2,
  memoryMb: 4096,
  pids: 1024,
  timeoutMs: 15 * 60_000,
};

const WORKDIR = '/work';
const CACHE = '/cache';

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

  const step = (command: string, fetching: boolean) =>
    sandbox.run({
      image: options.image ?? DEFAULT_SANDBOX_IMAGE,
      command: installShell(command),
      workdir: WORKDIR,
      mounts: [
        { hostPath: options.worktree, containerPath: WORKDIR, writable: true },
        { hostPath: options.cacheDir, containerPath: CACHE, writable: fetching },
      ],
      env: { ...INSTALL_ENV },
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
  }
  const install = await step(config.installCommand, false);
  return { status: succeeded(install) ? 'ok' : 'failed', fetch, install };
}

function succeeded(result: SandboxResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}
