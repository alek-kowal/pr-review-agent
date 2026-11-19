import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { labelledContainers, removeLabelledContainers } from '../testing/sandbox-containers.ts';
import {
  dockerSkipReason,
  ensureDockerImage,
  FakeSandbox,
  fileLabel,
  sandboxTestLabels,
  StoppableSandbox,
} from '../testing/sandbox.ts';
import { DockerSandbox } from './docker-sandbox.ts';
import { installDependencies, SHARED_STORE_DIR, type InstallCommands } from './install.ts';
import { DEFAULT_SANDBOX_IMAGE } from './sandbox.ts';

const FIXTURE = fileURLToPath(new URL('../testing/fixtures/install-repo/', import.meta.url));
const PNPM: InstallCommands = {
  fetchCommand: 'pnpm fetch --frozen-lockfile --ignore-scripts --ignore-pnpmfile',
  installCommand: 'pnpm install --offline --frozen-lockfile',
};

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pra-install-'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe('installDependencies steps', () => {
  beforeAll(() => mkdir(path.join(root, 'wt'), { recursive: true }));
  const options = () => ({
    worktree: path.join(root, 'wt'),
    cacheDir: path.join(root, 'cache-fake'),
    config: PNPM,
  });

  test('fetch with network and a writable cache, then install offline with the cache read-only', async () => {
    const sandbox = new FakeSandbox();
    const result = await installDependencies(sandbox, options());
    expect(result.status).toBe('ok');

    const [fetch, install] = sandbox.calls;
    expect(sandbox.calls).toHaveLength(2);
    expect(fetch!.network).toBe('egress');
    expect(fetch!.command.at(-1)).toMatch(/&& pnpm fetch --frozen-lockfile --ignore-scripts/);
    expect(fetch!.mounts).toEqual([
      { hostPath: path.join(root, 'wt'), containerPath: '/work', writable: true },
      { hostPath: path.join(root, 'cache-fake'), containerPath: '/cache', writable: true },
    ]);
    expect(install!.network).toBe('none');
    expect(install!.command.at(-1)).toMatch(/&& pnpm install --offline --frozen-lockfile$/);
    expect(install!.mounts).toEqual([
      { hostPath: path.join(root, 'wt'), containerPath: '/work', writable: true },
      { hostPath: path.join(root, 'cache-fake'), containerPath: '/cache', writable: false },
    ]);
  });

  test('the container env holds no worker variable and no credential', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY_TEST = 'secret';
    try {
      const sandbox = new FakeSandbox();
      await installDependencies(sandbox, options());
      for (const call of sandbox.calls) {
        expect(Object.keys(call.env ?? {}).sort()).toEqual([
          'COREPACK_ENABLE_DOWNLOAD_PROMPT',
          'COREPACK_HOME',
          'HOME',
          'PATH',
          'npm_config_store_dir',
        ]);
      }
    } finally {
      delete process.env.GITHUB_APP_PRIVATE_KEY_TEST;
    }
  });

  test('a failed fetch stops before the install', async () => {
    const sandbox = new FakeSandbox(() => ({ exitCode: 1, output: 'ERR_PNPM_FETCH' }));
    const result = await installDependencies(sandbox, options());
    expect(result).toMatchObject({ status: 'failed', fetch: { exitCode: 1 }, install: null });
    expect(sandbox.calls).toHaveLength(1);
  });

  test('a timed-out install is failed', async () => {
    const sandbox = new FakeSandbox((_, call) =>
      call === 1 ? { exitCode: null, timedOut: true } : {},
    );
    expect((await installDependencies(sandbox, options())).status).toBe('failed');
  });

  test('shared store: both steps use the store linked into the worktree; fetched files go back', async () => {
    const worktree = path.join(root, 'wt-shared');
    const cacheDir = path.join(root, 'cache-shared');
    const store = path.join(cacheDir, 'store');
    const known = path.join('v10', 'files', 'ab', 'known');
    const fetched = path.join('v10', 'files', 'cd', 'fetched');
    await mkdir(path.dirname(path.join(store, known)), { recursive: true });
    await writeFile(path.join(store, known), 'package file');
    await mkdir(worktree, { recursive: true });
    // Whatever the PR put at the name is replaced, never followed.
    const outside = path.join(root, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(worktree, SHARED_STORE_DIR));

    const linked = path.join(worktree, SHARED_STORE_DIR);
    const sandbox = new FakeSandbox(async (spec, call) => {
      expect(spec.env?.npm_config_store_dir).toBe(`/work/${SHARED_STORE_DIR}`);
      if (call === 0) {
        // The store's file is the same inode in the worktree: pnpm links it, no copy.
        expect((await stat(path.join(linked, known))).ino).toBe(
          (await stat(path.join(store, known))).ino,
        );
        await mkdir(path.dirname(path.join(linked, fetched)), { recursive: true });
        await writeFile(path.join(linked, fetched), 'downloaded');
      } else {
        // Before the install step runs PR code, the download is in the shared store.
        expect(await readFile(path.join(store, fetched), 'utf8')).toBe('downloaded');
      }
      return {};
    });
    const result = await installDependencies(sandbox, { worktree, cacheDir, config: PNPM });

    expect(result.status).toBe('ok');
    expect(sandbox.calls).toHaveLength(2);
    expect(existsSync(linked)).toBe(false);
    expect(await readdir(outside)).toEqual([]);
    expect((await stat(path.join(store, known))).nlink).toBe(1);
    expect((await stat(path.join(store, fetched))).nlink).toBe(1);
  });

  test('sharedStore false: both steps use the mounted cache store (pnpm copies)', async () => {
    const off = new FakeSandbox();
    await installDependencies(off, { ...options(), sharedStore: false });
    expect(off.calls.map((call) => call.env?.npm_config_store_dir)).toEqual([
      '/cache/store',
      '/cache/store',
    ]);
  });

  test('without a fetch command only the offline install runs; without an install command nothing runs', async () => {
    const sandbox = new FakeSandbox();
    const installOnly = await installDependencies(sandbox, {
      ...options(),
      config: { fetchCommand: null, installCommand: 'npm ci --offline' },
    });
    expect(installOnly).toMatchObject({ status: 'ok', fetch: null });
    expect(sandbox.calls.map((c) => c.network)).toEqual(['none']);

    const skipped = await installDependencies(new FakeSandbox(), {
      ...options(),
      config: { fetchCommand: 'pnpm fetch', installCommand: null },
    });
    expect(skipped).toEqual({ status: 'skipped', fetch: null, install: null });
  });
});

const skipReason = await dockerSkipReason();
if (skipReason) console.warn(`install.test.ts Docker part skipped: ${skipReason}`);

describe.skipIf(skipReason)('installDependencies in Docker', () => {
  const labels = sandboxTestLabels();

  beforeAll(() => ensureDockerImage(DEFAULT_SANDBOX_IMAGE), 300_000);
  const sandbox = new StoppableSandbox(new DockerSandbox());

  // A failed or timed-out test's container goes here; an interrupted run's, in the global
  // setup's teardown.
  afterAll(async () => {
    await sandbox.stop();
    await removeLabelledContainers(fileLabel(labels));
  }, 60_000);

  test('installs the fixture offline; its postinstall cannot reach the network', async () => {
    const worktree = path.join(root, 'fixture');
    await cp(FIXTURE, worktree, { recursive: true });

    const result = await installDependencies(sandbox, {
      worktree,
      cacheDir: path.join(root, 'cache'),
      config: PNPM,
      labels,
    });

    expect(result.fetch?.exitCode, result.fetch?.outputTail).toBe(0);
    expect(result.install?.exitCode, result.install?.outputTail).toBe(0);
    expect(result.status).toBe('ok');
    expect(existsSync(path.join(worktree, 'node_modules', 'is-number', 'package.json'))).toBe(true);
    expect(await readFile(path.join(worktree, 'postinstall-network.txt'), 'utf8')).toBe('failed');
    expect(existsSync(path.join(worktree, SHARED_STORE_DIR))).toBe(false);
    expect(await labelledContainers(fileLabel(labels))).toEqual([]);

    // A second install of the same worktree (a Checks retry) finds the store where the first left
    // it: pnpm refuses a node_modules made from another store location.
    const again = await installDependencies(sandbox, {
      worktree,
      cacheDir: path.join(root, 'cache'),
      config: PNPM,
      labels,
    });
    expect(again.install?.exitCode, again.install?.outputTail).toBe(0);
  }, 300_000);
});
