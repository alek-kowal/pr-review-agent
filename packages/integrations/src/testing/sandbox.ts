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
