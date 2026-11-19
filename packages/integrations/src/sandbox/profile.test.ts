import { describe, expect, test } from 'vitest';
import { FakeSandbox } from '../testing/sandbox.ts';
import { sandboxRuntimeFrom } from './docker-sandbox.ts';
import {
  ConfigValueError,
  DEFAULT_SANDBOX_PROFILE,
  LimitedSandbox,
  sandboxProfileFromEnv,
} from './profile.ts';
import { SANDBOX_CANCELLED, type SandboxRunSpec } from './sandbox.ts';

const spec = (signal?: AbortSignal): SandboxRunSpec => ({
  image: 'node:24-slim',
  command: ['true'],
  workdir: '/work',
  mounts: [],
  limits: DEFAULT_SANDBOX_PROFILE.repro,
  signal,
});

/** A sandbox whose runs end only when the test says so. */
function gatedSandbox() {
  const releases: Array<() => void> = [];
  let running = 0;
  let peak = 0;
  const sandbox = new FakeSandbox(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running -= 1;
    return {};
  });
  return {
    sandbox,
    peak: () => peak,
    started: () => sandbox.calls.length,
    finishNext: async () => {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('sandboxProfileFromEnv', () => {
  test('defaults fit a 1-vCPU, 4 GB host', () => {
    const profile = sandboxProfileFromEnv({});
    expect(profile).toEqual(DEFAULT_SANDBOX_PROFILE);
    expect(profile.install).toEqual({ cpus: 1, memoryMb: 2048, pids: 1024, timeoutMs: 900_000 });
    expect(profile.fetch.timeoutMs).toBe(600_000);
    expect(profile.repro.timeoutMs).toBe(300_000);
    expect(profile.sharedStore).toBe(true);
  });

  test('caps apply to every kind of run; each kind keeps its own timeout', () => {
    const profile = sandboxProfileFromEnv({
      SANDBOX_CPUS: '0.5',
      SANDBOX_MEMORY_MB: '1536',
      SANDBOX_PIDS: '256',
      SANDBOX_FETCH_TIMEOUT_MINUTES: '4',
      SANDBOX_INSTALL_TIMEOUT_MINUTES: '20',
      SANDBOX_REPRO_TIMEOUT_MINUTES: '2',
      SANDBOX_SHARED_STORE: 'false',
    });
    for (const limits of [profile.fetch, profile.install, profile.repro]) {
      expect(limits).toMatchObject({ cpus: 0.5, memoryMb: 1536, pids: 256 });
    }
    expect([profile.fetch, profile.install, profile.repro].map((l) => l.timeoutMs)).toEqual([
      240_000, 1_200_000, 120_000,
    ]);
    expect(profile.sharedStore).toBe(false);
  });

  test.each([
    ['SANDBOX_MEMORY_MB', '2g'],
    ['SANDBOX_MEMORY_MB', '1.5'],
    ['SANDBOX_PIDS', '0'],
    ['SANDBOX_CPUS', '-1'],
    ['SANDBOX_INSTALL_TIMEOUT_MINUTES', 'soon'],
    ['SANDBOX_SHARED_STORE', 'maybe'],
  ])('%s=%s is refused, naming the variable', (name, value) => {
    expect(() => sandboxProfileFromEnv({ [name]: value })).toThrow(ConfigValueError);
    expect(() => sandboxProfileFromEnv({ [name]: value })).toThrow(name);
  });

  test('SANDBOX_RUNTIME is auto, runc or runsc', () => {
    expect(sandboxRuntimeFrom(undefined)).toBe('auto');
    expect(sandboxRuntimeFrom(' runsc ')).toBe('runsc');
    expect(() => sandboxRuntimeFrom('kata')).toThrow('SANDBOX_RUNTIME');
  });
});

describe('LimitedSandbox', () => {
  test('with a limit of 1, runs from every caller go one after another, in order', async () => {
    const gated = gatedSandbox();
    const sandbox = new LimitedSandbox(gated.sandbox, 1);
    const runs = [sandbox.run(spec()), sandbox.run(spec()), sandbox.run(spec())];
    await settle();
    expect(gated.started()).toBe(1);
    expect(sandbox.load).toEqual({ running: 1, waiting: 2 });

    await gated.finishNext();
    expect(gated.started()).toBe(2);
    await gated.finishNext();
    await gated.finishNext();
    await Promise.all(runs);
    expect(gated.peak()).toBe(1);
    expect(sandbox.load).toEqual({ running: 0, waiting: 0 });
  });

  test('a limit of 2 runs two at once', async () => {
    const gated = gatedSandbox();
    const sandbox = new LimitedSandbox(gated.sandbox, 2);
    const runs = [sandbox.run(spec()), sandbox.run(spec()), sandbox.run(spec())];
    await settle();
    expect(gated.started()).toBe(2);
    for (let i = 0; i < 3; i += 1) await gated.finishNext();
    await Promise.all(runs);
    expect(gated.peak()).toBe(2);
  });

  test('a waiting run whose signal aborts leaves the line and starts nothing', async () => {
    const gated = gatedSandbox();
    const sandbox = new LimitedSandbox(gated.sandbox, 1);
    const first = sandbox.run(spec());
    const controller = new AbortController();
    const cancelled = sandbox.run(spec(controller.signal));
    const third = sandbox.run(spec());
    await settle();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: SANDBOX_CANCELLED });
    expect(sandbox.load).toEqual({ running: 1, waiting: 1 });

    await gated.finishNext();
    await gated.finishNext();
    await Promise.all([first, third]);
    expect(gated.started()).toBe(2);
  });

  test('a failed run frees its place', async () => {
    let call = 0;
    const sandbox = new LimitedSandbox(
      new FakeSandbox(() => {
        call += 1;
        if (call === 1) throw new Error('docker gone');
        return {};
      }),
      1,
    );
    await expect(sandbox.run(spec())).rejects.toThrow('docker gone');
    await expect(sandbox.run(spec())).resolves.toMatchObject({ exitCode: 0 });
  });

  test('the limit is at least 1', () => {
    expect(() => new LimitedSandbox(new FakeSandbox(), 0)).toThrow(RangeError);
  });
});
