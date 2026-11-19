import { execa } from 'execa';
import type { Sandbox, SandboxResult, SandboxRunSpec } from '../sandbox/sandbox.ts';

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

/** Ids of the containers, running or not, that carry `label` (`key=value`). */
export async function labelledContainers(label: string): Promise<string[]> {
  const { stdout } = await execa('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=${label}`,
  ]);
  return stdout.split('\n').filter(Boolean);
}

/** Pulls `image` when the daemon does not have it yet. */
export async function ensureDockerImage(image: string): Promise<void> {
  const found = await execa('docker', ['image', 'inspect', image], { reject: false });
  if (found.exitCode !== 0) await execa('docker', ['pull', '--quiet', image]);
}
