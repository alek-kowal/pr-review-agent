import { randomUUID } from 'node:crypto';
import { execa } from 'execa';
import { inject } from 'vitest';
import type { Sandbox, SandboxResult, SandboxRunSpec } from '../sandbox/sandbox.ts';
import './provided-context.ts';
import {
  SANDBOX_TEST_LABEL,
  SANDBOX_TEST_OWNER_LABEL,
  SANDBOX_TEST_SESSION_LABEL,
} from './sandbox-containers.ts';

export type FakeSandboxHandler = (
  spec: SandboxRunSpec,
  call: number,
) => Partial<SandboxResult> | Promise<Partial<SandboxResult>>;

/**
 * A `Sandbox` that records every run and answers from `handler` (default: exit 0, no output).
 * The handler may throw, e.g. an `IntegrationNotConfiguredError('sandbox_not_configured')`.
 */
export class FakeSandbox implements Sandbox {
  readonly calls: SandboxRunSpec[] = [];
  readonly #handler: FakeSandboxHandler;

  constructor(handler: FakeSandboxHandler = () => ({})) {
    this.#handler = handler;
  }

  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    this.calls.push(spec);
    const partial = await this.#handler(spec, this.calls.length - 1);
    const output = partial.output ?? '';
    return {
      exitCode: 0,
      output,
      outputTail: output.slice(-4_000),
      timedOut: false,
      durationMs: 1,
      ...partial,
    };
  }
}

/**
 * Why Docker tests cannot run here, or null when the local daemon answers. Docker tests skip with
 * this reason printed.
 */
export async function dockerSkipReason(): Promise<string | null> {
  const docker = await execa('docker', ['version', '--format', '{{.Server.Version}}'], {
    reject: false,
    timeout: 15_000,
  });
  return docker.exitCode === 0
    ? null
    : `Docker is not reachable (docker version: ${docker.exitCode})`;
}

/**
 * A real sandbox for tests that can stop its runs. A timed-out test leaves its run going; if the
 * file ended then, the worker would exit before the run removed its container (left Created or
 * Exited). `stop()` in `afterAll` aborts the runs still going and waits until each has removed
 * its container.
 */
export class StoppableSandbox implements Sandbox {
  readonly #inner: Sandbox;
  readonly #stop = new AbortController();
  readonly #running = new Set<Promise<unknown>>();

  constructor(inner: Sandbox) {
    this.#inner = inner;
  }

  run(spec: SandboxRunSpec): Promise<SandboxResult> {
    const signal = spec.signal
      ? AbortSignal.any([spec.signal, this.#stop.signal])
      : this.#stop.signal;
    const run = this.#inner.run({ ...spec, signal });
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#running.add(settled);
    void settled.then(() => this.#running.delete(settled));
    return run;
  }

  async stop(): Promise<void> {
    this.#stop.abort();
    await Promise.all(this.#running);
  }
}

/**
 * The labels of one test file's sandbox runs: its own id, for its "no container left" checks and
 * its `afterAll`; the test run's session, which the global setup's teardown removes; and the
 * run's owner process, so the next run removes them if this one was interrupted.
 */
export function sandboxTestLabels(): Record<string, string> {
  return {
    [SANDBOX_TEST_LABEL]: randomUUID(),
    [SANDBOX_TEST_SESSION_LABEL]: inject('sandboxTestSession'),
    [SANDBOX_TEST_OWNER_LABEL]: inject('sandboxTestOwner'),
  };
}

/** The file's own label of `sandboxTestLabels()`, as `key=value`. */
export const fileLabel = (labels: Record<string, string>) =>
  `${SANDBOX_TEST_LABEL}=${labels[SANDBOX_TEST_LABEL]}`;

/** Pulls `image` when the daemon does not have it yet. */
export async function ensureDockerImage(image: string): Promise<void> {
  const found = await execa('docker', ['image', 'inspect', image], { reject: false });
  if (found.exitCode !== 0) await execa('docker', ['pull', '--quiet', image]);
}
