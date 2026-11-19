import type Anthropic from '@anthropic-ai/sdk';
import { agentError, agentResult } from '../agent-result.ts';
import type { Judge, JudgeInput, JudgeOutput, MessagesClient } from '../judge/judge.ts';
import type { AgentErrorCode, AgentRunResult } from '../runner.ts';

/** One scripted judgement: an answer or a failure. */
export type FakeJudgeStep =
  (JudgeOutput & { costUsd?: number }) | { fail: AgentErrorCode; params?: Record<string, unknown> };

/**
 * `Judge` for stage tests: answers each call with the next scripted step and records the input.
 * With the script empty it throws, so an unexpected judge call fails the test.
 */
export class FakeJudge implements Judge {
  readonly calls: JudgeInput[] = [];
  readonly #steps: FakeJudgeStep[];

  constructor(steps: FakeJudgeStep[] = []) {
    this.#steps = [...steps];
  }

  /** Adds steps to the end of the script. */
  enqueue(...steps: FakeJudgeStep[]): this {
    this.#steps.push(...steps);
    return this;
  }

  async judge(input: JudgeInput): Promise<AgentRunResult<JudgeOutput>> {
    this.calls.push(input);
    const step = this.#steps.shift();
    if (!step) throw new Error('FakeJudge: no scripted step left');
    if ('fail' in step) {
      return agentResult({ status: 'failed', error: agentError(step.fail, step.params), turns: 1 });
    }
    const { costUsd = 0.001, ...output } = step;
    return agentResult({ status: 'completed', output, costUsd, turns: 1 });
  }
}

/**
 * A Messages API double for `AnthropicJudge`: records each request and answers with `text` (the
 * model's JSON) and the given token usage, or throws `error`.
 */
export class FakeMessagesClient implements MessagesClient {
  readonly requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  readonly messages: MessagesClient['messages'];

  constructor(
    answer:
      | { text: string; usage?: Partial<Anthropic.Usage>; stopReason?: Anthropic.StopReason }
      | { error: unknown },
  ) {
    this.messages = {
      create: async (body) => {
        this.requests.push(body);
        if ('error' in answer) throw answer.error;
        return fakeMessage(body.model, answer.text, answer.usage, answer.stopReason);
      },
    };
  }
}

function fakeMessage(
  model: string,
  text: string,
  usage: Partial<Anthropic.Usage> = {},
  stopReason: Anthropic.StopReason = 'end_turn',
): Anthropic.Message {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      ...usage,
    },
  } as Anthropic.Message;
}
