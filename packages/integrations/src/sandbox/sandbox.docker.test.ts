import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DockerSandbox } from './docker-sandbox.ts';
import { DEFAULT_SANDBOX_IMAGE, type SandboxRunSpec } from './sandbox.ts';

/** Real containers on the local Docker daemon. Skipped, with the reason printed, without one. */
const docker = await execa('docker', ['version', '--format', '{{.Server.Version}}'], {
  reject: false,
  timeout: 15_000,
});
const skipReason =
  docker.exitCode === 0 ? null : `Docker is not reachable (docker version: ${docker.exitCode})`;
if (skipReason) console.warn(`sandbox.docker.test.ts skipped: ${skipReason}`);

/** Every container of this test run carries this label, so cleanup is checked by it. */
const RUN_LABEL = 'pra.sandbox.test';
const runId = randomUUID();

async function leftoverContainers(): Promise<string[]> {
  const { stdout } = await execa('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=${RUN_LABEL}=${runId}`,
  ]);
  return stdout.split('\n').filter(Boolean);
}

describe.skipIf(skipReason)('DockerSandbox on the local daemon', () => {
  const sandbox = new DockerSandbox();
  let dir: string;

  const run = (command: string, extra: Partial<SandboxRunSpec> = {}) =>
    sandbox.run({
      image: DEFAULT_SANDBOX_IMAGE,
      command: ['sh', '-c', command],
      workdir: '/work',
      mounts: [{ hostPath: dir, containerPath: '/work' }],
      limits: { cpus: 1, memoryMb: 256, pids: 64, timeoutMs: 60_000 },
      labels: { [RUN_LABEL]: runId },
      ...extra,
    });

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pra-sbx-'));
    const image = await execa('docker', ['image', 'inspect', DEFAULT_SANDBOX_IMAGE], {
      reject: false,
    });
    if (image.exitCode !== 0) await execa('docker', ['pull', '--quiet', DEFAULT_SANDBOX_IMAGE]);
  }, 300_000);

  afterAll(async () => {
    const left = await leftoverContainers();
    if (left.length) await execa('docker', ['rm', '--force', ...left], { reject: false });
    await rm(dir, { recursive: true, force: true });
  });

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
    const result = await run(probe, {
      limits: { cpus: 1, memoryMb: 256, pids: 64, timeoutMs: 30_000 },
    });
    expect(result.exitCode).toBe(3);
  });

  test('mounts read-only unless writable, and the root filesystem is read-only', async () => {
    expect((await run('touch /work/ro.txt')).exitCode).not.toBe(0);
    expect(existsSync(path.join(dir, 'ro.txt'))).toBe(false);
    expect((await run('touch /usr/local/x')).exitCode).not.toBe(0);

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
