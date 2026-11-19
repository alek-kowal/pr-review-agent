import { agentError, agentResult } from '../agent-result.ts';
import type { Analyst, AnalystInput, AnalystOutput } from '../analyst/analyst.ts';
import type { AgentErrorCode, AgentRunResult } from '../runner.ts';

/** One scripted analysis: an answer or a failure. */
export type FakeAnalystStep =
  | (Partial<AnalystOutput> & Pick<AnalystOutput, 'candidates'> & { costUsd?: number })
  | { fail: AgentErrorCode; params?: Record<string, unknown> };

/**
 * `Analyst` for job tests: answers each call with the next scripted step (or `answer(input)` when
 * the script is empty) and records the input. Without either it throws, so an unexpected analyst
 * call fails the test.
 */
export class FakeAnalyst implements Analyst {
  readonly calls: AnalystInput[] = [];
  readonly #steps: FakeAnalystStep[];
  readonly #answer: ((input: AnalystInput) => FakeAnalystStep) | undefined;

  constructor(steps: FakeAnalystStep[] = [], answer?: (input: AnalystInput) => FakeAnalystStep) {
    this.#steps = [...steps];
    this.#answer = answer;
  }

  /** Adds steps to the end of the script. */
  enqueue(...steps: FakeAnalystStep[]): this {
    this.#steps.push(...steps);
    return this;
  }

  async analyse(input: AnalystInput): Promise<AgentRunResult<AnalystOutput>> {
    this.calls.push(input);
    const step = this.#steps.shift() ?? this.#answer?.(input);
    if (!step) throw new Error('FakeAnalyst: no scripted step left');
    if ('fail' in step) {
      return agentResult({ status: 'failed', error: agentError(step.fail, step.params), turns: 1 });
    }
    const { costUsd = 0.07, candidates, summary = '' } = step;
    return agentResult({
      status: 'completed',
      output: { candidates, summary },
      costUsd,
      turns: 1,
    });
  }
}
