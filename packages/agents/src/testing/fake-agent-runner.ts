import {
  NO_USAGE,
  type AgentErrorCode,
  type AgentProgress,
  type AgentRunInput,
  type AgentRunner,
  type AgentRunResult,
  type AgentUsage,
} from '../runner.ts';

/**
 * One scripted session: an answer, a failure, or a function of the input. `progress` is sent to
 * the caller's `onProgress` in order, one per turn, before the result (running totals, as the
 * real adapter reports them).
 */
export type FakeAgentStep =
  | {
      output: unknown;
      costUsd?: number;
      turns?: number;
      usage?: Partial<AgentUsage>;
      progress?: readonly AgentProgress[];
    }
  | {
      fail: AgentErrorCode;
      params?: Record<string, unknown>;
      costUsd?: number;
      turns?: number;
      progress?: readonly AgentProgress[];
    }
  | ((input: AgentRunInput<unknown>) => AgentRunResult<unknown> | Promise<AgentRunResult<unknown>>);

/**
 * `AgentRunner` for tests: it answers each `run` with the next scripted step and records the
 * input. Answers are parsed with the caller's `outputSchema`, so a malformed one fails with
 * `output_invalid` like the real adapter. Costs are `reported`, as from a finished session.
 */
export class FakeAgentRunner implements AgentRunner {
  readonly calls: AgentRunInput<unknown>[] = [];
  readonly #steps: FakeAgentStep[];

  constructor(steps: FakeAgentStep[] = []) {
    this.#steps = [...steps];
  }

  /** Adds steps to the end of the script. */
  enqueue(...steps: FakeAgentStep[]): this {
    this.#steps.push(...steps);
    return this;
  }

  get remaining(): number {
    return this.#steps.length;
  }

  async run<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    this.calls.push(input as AgentRunInput<unknown>);
    const step = this.#steps.shift();
    if (!step) throw new Error(`FakeAgentRunner: no scripted step left for ${input.role}`);
    if (typeof step === 'function') {
      return (await step(input as AgentRunInput<unknown>)) as AgentRunResult<T>;
    }
    for (const progress of step.progress ?? []) {
      input.onProgress?.(progress);
      await new Promise((resolve) => setImmediate(resolve));
    }

    const base = {
      usage: { ...NO_USAGE, ...('usage' in step ? step.usage : {}) },
      costUsd: step.costUsd ?? 0,
      costSource: 'reported' as const,
      turns: step.turns ?? 1,
      durationMs: 1,
      transcript: [{ type: 'fake', role: input.role, model: input.model }],
    };
    if ('fail' in step) {
      return {
        ...base,
        status: step.fail === 'cancelled' ? 'cancelled' : 'failed',
        output: null,
        error: { code: step.fail, params: step.params ?? {} },
      };
    }
    const parsed = input.outputSchema.safeParse(step.output);
    if (!parsed.success) {
      return {
        ...base,
        status: 'failed',
        output: null,
        error: {
          code: 'output_invalid',
          params: { issues: parsed.error.issues.map(({ path, code }) => ({ path, code })) },
        },
      };
    }
    return { ...base, status: 'completed', output: parsed.data, error: null };
  }
}
