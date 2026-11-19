import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  dockerSkipReason,
  ensureDockerImage,
  FakeSandbox,
  labelledContainers,
} from '../testing/sandbox.ts';
import { DockerSandbox } from './docker-sandbox.ts';
import { installDependencies, type InstallCommands } from './install.ts';
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
  const labels = { 'pra.sandbox.test': randomUUID() };

  beforeAll(() => ensureDockerImage(DEFAULT_SANDBOX_IMAGE), 300_000);
  afterAll(async () => {
    const left = await labelledContainers(`pra.sandbox.test=${labels['pra.sandbox.test']}`);
    if (left.length) await execa('docker', ['rm', '--force', ...left], { reject: false });
  });

  test('installs the fixture offline; its postinstall cannot reach the network', async () => {
    const worktree = path.join(root, 'fixture');
    await cp(FIXTURE, worktree, { recursive: true });

    const result = await installDependencies(new DockerSandbox(), {
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
    expect(await labelledContainers(`pra.sandbox.test=${labels['pra.sandbox.test']}`)).toEqual([]);
  }, 300_000);
});
