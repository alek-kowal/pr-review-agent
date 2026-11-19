import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { labelledContainers, removeLabelledContainers } from '../testing/sandbox-containers.ts';
import {
  dockerSkipReason,
  ensureDockerImage,
  fileLabel,
  sandboxTestLabels,
  StoppableSandbox,
} from '../testing/sandbox.ts';
import { DockerSandbox } from './docker-sandbox.ts';
import { DEFAULT_SANDBOX_IMAGE, type SandboxRunSpec } from './sandbox.ts';

/** Real containers on the local Docker daemon. Skipped, with the reason printed, without one. */
const skipReason = await dockerSkipReason();
if (skipReason) console.warn(`sandbox.docker.test.ts skipped: ${skipReason}`);

/**
 * The time limit of each container run. Every `pnpm test` on this machine (one per worktree)
 * shares one Docker daemon: idle a run (create, start, rm) takes ~0.4 s, with parallel runs 2–4 s.
 */
const RUN_LIMIT_MS = 30_000;
/**
 * Each test runs one container, so its budget is one run plus the CLI calls around it. Vitest's
 * 5 s default is for in-process tests and cut off runs that had not reached their own limit.
 */
const ONE_RUN_PER_TEST = { timeout: RUN_LIMIT_MS + 15_000 };

/** Every container of this file carries its own label, so cleanup is checked by it. */
const labels = sandboxTestLabels();
const leftoverContainers = () => labelledContainers(fileLabel(labels));

describe.skipIf(skipReason)('DockerSandbox on the local daemon', ONE_RUN_PER_TEST, () => {
  const sandbox = new StoppableSandbox(new DockerSandbox());
  let dir: string;

  const run = (command: string, extra: Partial<SandboxRunSpec> = {}) =>
    sandbox.run({
      image: DEFAULT_SANDBOX_IMAGE,
      command: ['sh', '-c', command],
      workdir: '/work',
      mounts: [{ hostPath: dir, containerPath: '/work' }],
      limits: { cpus: 1, memoryMb: 256, pids: 64, timeoutMs: RUN_LIMIT_MS },
      labels,
      ...extra,
    });

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pra-sbx-'));
    await ensureDockerImage(DEFAULT_SANDBOX_IMAGE);
  }, 300_000);

  // A failed or timed-out test's container goes here; an interrupted run's, in the global
  // setup's teardown.
  afterAll(async () => {
    await sandbox.stop();
    await removeLabelledContainers(fileLabel(labels));
    await rm(dir, { recursive: true, force: true });
  }, 60_000);

  test('returns the exit code and the combined output', async () => {
    const result = await run('echo out; echo err >&2; exit 7');
    expect(result).toMatchObject({ exitCode: 7, timedOut: false });
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
    expect(result.outputTail).toBe(result.output);
    expect(await leftoverContainers()).toEqual([]);
  });

  test('has no network by default', async () => {
    const probe = `node -e "fetch('http://example.com').then(() => process.exit(0), () => process.exit(3))"`;
    const result = await run(probe);
    expect(result.exitCode).toBe(3);
  });

  // One container per test: three runs in one test were what timed out under load.
  test('mounts read-only by default', async () => {
    expect((await run('touch /work/ro.txt')).exitCode).not.toBe(0);
    expect(existsSync(path.join(dir, 'ro.txt'))).toBe(false);
  });

  test('the root filesystem is read-only', async () => {
    expect((await run('touch /usr/local/x')).exitCode).not.toBe(0);
  });

  test('a writable mount and /tmp can be written', async () => {
    const writable = await run('touch /work/rw.txt && touch /tmp/scratch', {
      mounts: [{ hostPath: dir, containerPath: '/work', writable: true }],
    });
    expect(writable.exitCode).toBe(0);
    expect(existsSync(path.join(dir, 'rw.txt'))).toBe(true);
  });

  test('passes only the allow-listed env, never the worker env', async () => {
    process.env.PRA_SANDBOX_SECRET_TEST = 'worker-secret-value';
    try {
      const result = await run('env', { env: { ALLOWED: 'yes' } });
      expect(result.output).toContain('ALLOWED=yes');
      expect(result.output).not.toContain('worker-secret-value');
    } finally {
      delete process.env.PRA_SANDBOX_SECRET_TEST;
    }
  });

  test('runs as a non-root user without capabilities', async () => {
    const result = await run('id -u; grep CapEff /proc/self/status');
    expect(result.output.split('\n')[0]).not.toBe('0');
    expect(result.output).toMatch(/CapEff:\s+0+\n/);
  });

  test('kills the container at the time limit and removes it', async () => {
    const result = await run('sleep 30', {
      limits: { cpus: 1, memoryMb: 256, pids: 64, timeoutMs: 1_500 },
    });
    expect(result).toMatchObject({ exitCode: null, timedOut: true });
    expect(result.durationMs).toBeLessThan(15_000);
    expect(await leftoverContainers()).toEqual([]);
  });

  test('an abort rejects with sandbox_cancelled and removes the container', async () => {
    const controller = new AbortController();
    const pending = run('sleep 30', { signal: controller.signal });
    setTimeout(() => controller.abort(), 1_500);
    await expect(pending).rejects.toMatchObject({ code: 'sandbox_cancelled' });
    expect(await leftoverContainers()).toEqual([]);
  });
});
